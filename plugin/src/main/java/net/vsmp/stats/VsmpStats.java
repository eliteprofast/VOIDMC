package net.vsmp.stats;

import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.Statistic;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.scheduler.BukkitTask;

import java.lang.reflect.Method;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Sends each player's balance, kills, deaths and playtime to the VSMP website every few minutes,
 * so the website leaderboard stays up to date by itself.
 * Balance comes from Vault (EssentialsX and most economy plugins work). Clan is optional (PlaceholderAPI).
 */
public final class VsmpStats extends JavaPlugin {

    private static final class Row {
        String name; String clan = ""; double balance; long kills; long deaths; double hours;
    }

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private BukkitTask timer;
    private volatile String lastResult = "no update sent yet";

    private Object economy;
    private Method economyBalance;
    private Statistic killsStat;
    private Statistic deathsStat;
    private Statistic playStat;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        killsStat = findStat("PLAYER_KILLS");
        deathsStat = findStat("DEATHS");
        playStat = findStat("PLAY_ONE_MINUTE", "PLAY_TIME");
        hookVault();
        startTimer();
        getLogger().info("VSMPStats enabled. Balance source: " + (economy != null ? "Vault" : "none (Vault not found)")
                + ". Updates every " + minutes() + " minute(s).");
        if (!configured()) {
            getLogger().warning("Set 'url' and 'key' in plugins/VSMPStats/config.yml, then run /vsmpstats reload.");
        }
    }

    @Override
    public void onDisable() {
        if (timer != null) timer.cancel();
    }

    private long minutes() {
        return Math.max(1L, getConfig().getLong("interval-minutes", 5L));
    }

    private void startTimer() {
        if (timer != null) timer.cancel();
        long ticks = 20L * 60L * minutes();
        timer = Bukkit.getScheduler().runTaskTimer(this, this::startSync, 20L * 30L, ticks);
    }

    private boolean configured() {
        String url = getConfig().getString("url", "");
        String key = getConfig().getString("key", "");
        return url.startsWith("http") && !url.contains("YOUR-SITE") && key.length() >= 16 && !key.contains("PUT-YOUR");
    }

    private Statistic findStat(String... names) {
        for (String n : names) {
            try {
                return Statistic.valueOf(n);
            } catch (IllegalArgumentException ignored) {
                // try the next name (Minecraft renamed some statistics over time)
            }
        }
        return null;
    }

    private void hookVault() {
        try {
            Class<?> eco = Class.forName("net.milkbowl.vault.economy.Economy");
            RegisteredServiceProvider<?> rsp = Bukkit.getServicesManager().getRegistration(eco);
            if (rsp != null) {
                economy = rsp.getProvider();
                economyBalance = eco.getMethod("getBalance", OfflinePlayer.class);
            }
        } catch (Throwable ignored) {
            economy = null;
        }
    }

    private long stat(OfflinePlayer p, Statistic s) {
        if (s == null) return 0L;
        try {
            return p.getStatistic(s);
        } catch (Throwable t) {
            return 0L;
        }
    }

    private String clanOf(OfflinePlayer p) {
        String placeholder = getConfig().getString("clan-placeholder", "");
        if (placeholder == null || placeholder.isEmpty()) return "";
        try {
            Class<?> papi = Class.forName("me.clip.placeholderapi.PlaceholderAPI");
            Method m = papi.getMethod("setPlaceholders", OfflinePlayer.class, String.class);
            Object out = m.invoke(null, p, placeholder);
            String s = out == null ? "" : out.toString();
            return s.contains("%") ? "" : s;
        } catch (Throwable t) {
            return "";
        }
    }

    private Row read(OfflinePlayer p) {
        Row r = new Row();
        r.name = p.getName();
        if (economy != null && economyBalance != null) {
            try {
                r.balance = ((Number) economyBalance.invoke(economy, p)).doubleValue();
            } catch (Throwable ignored) {
                r.balance = 0.0;
            }
        }
        r.kills = stat(p, killsStat);
        r.deaths = stat(p, deathsStat);
        r.hours = stat(p, playStat) / 72000.0; // the statistic counts game ticks: 20 per second
        r.clan = clanOf(p);
        return r;
    }

    /** Collects the players a few at a time (so the server never lags), then sends them. */
    private void startSync() {
        if (!configured()) return;
        if (!running.compareAndSet(false, true)) return;

        int activeDays = getConfig().getInt("active-days", 30);
        long cutoff = activeDays > 0 ? System.currentTimeMillis() - activeDays * 86400000L : 0L;
        final List<OfflinePlayer> todo = new ArrayList<>();
        for (OfflinePlayer p : Bukkit.getOfflinePlayers()) {
            if (p.getName() == null) continue;
            if (p.isOnline() || (p.hasPlayedBefore() && p.getLastPlayed() >= cutoff)) todo.add(p);
        }
        final int perTick = Math.max(1, getConfig().getInt("players-per-tick", 15));
        final List<Row> rows = new ArrayList<>();
        final int[] next = {0};

        new BukkitRunnable() {
            @Override
            public void run() {
                int done = 0;
                while (next[0] < todo.size() && done < perTick) {
                    rows.add(read(todo.get(next[0]++)));
                    done++;
                }
                if (next[0] >= todo.size()) {
                    cancel();
                    finish(rows);
                }
            }
        }.runTaskTimer(this, 1L, 1L);
    }

    private void finish(List<Row> rows) {
        final boolean byBalance = economy != null;
        rows.sort((a, b) -> byBalance ? Double.compare(b.balance, a.balance) : Long.compare(b.kills, a.kills));
        int max = Math.max(1, Math.min(200, getConfig().getInt("max-players", 150)));
        final List<Row> send = new ArrayList<>(rows.subList(0, Math.min(max, rows.size())));
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                post(send);
            } finally {
                running.set(false);
            }
        });
    }

    private static String clean(String s, int max) {
        String t = s == null ? "" : s.replaceAll("[^A-Za-z0-9 _+.\\-]", "");
        return t.length() > max ? t.substring(0, max) : t;
    }

    private void post(List<Row> all) {
        String url = getConfig().getString("url", "");
        String key = getConfig().getString("key", "");
        int sent = 0;
        int batch = 80; // the website accepts up to 100 players per request
        try {
            for (int i = 0; i < all.size(); i += batch) {
                List<Row> part = all.subList(i, Math.min(all.size(), i + batch));
                StringBuilder sb = new StringBuilder("{\"players\":[");
                for (int j = 0; j < part.size(); j++) {
                    Row r = part.get(j);
                    if (j > 0) sb.append(',');
                    sb.append("{\"name\":\"").append(clean(r.name, 24)).append("\",")
                      .append("\"clan\":\"").append(clean(r.clan, 16)).append("\",")
                      .append("\"balance\":").append(String.format(Locale.ROOT, "%.2f", Math.max(0.0, r.balance))).append(',')
                      .append("\"kills\":").append(Math.max(0L, r.kills)).append(',')
                      .append("\"deaths\":").append(Math.max(0L, r.deaths)).append(',')
                      .append("\"playtime\":").append(String.format(Locale.ROOT, "%.1f", Math.max(0.0, r.hours)))
                      .append('}');
                }
                sb.append("]}");
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofSeconds(20))
                        .header("Authorization", "Bearer " + key)
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(sb.toString()))
                        .build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() == 200) {
                    sent += part.size();
                } else {
                    String body = res.body() == null ? "" : res.body();
                    lastResult = "the website said HTTP " + res.statusCode() + ": " + (body.length() > 160 ? body.substring(0, 160) : body);
                    getLogger().warning("Leaderboard update refused: " + lastResult);
                    return;
                }
            }
            lastResult = "sent " + sent + " player(s) at " + new java.text.SimpleDateFormat("HH:mm:ss").format(new java.util.Date());
            getLogger().info("Leaderboard updated: " + lastResult);
        } catch (Exception e) {
            lastResult = "could not reach the website: " + e.getClass().getSimpleName() + " " + e.getMessage();
            getLogger().warning("Leaderboard update failed: " + lastResult);
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("vsmpstats.admin")) {
            sender.sendMessage("You don't have permission to do that.");
            return true;
        }
        String sub = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
        switch (sub) {
            case "sync":
                if (!configured()) {
                    sender.sendMessage("Set 'url' and 'key' in plugins/VSMPStats/config.yml first, then /vsmpstats reload.");
                } else if (running.get()) {
                    sender.sendMessage("An update is already running. Check again in a moment with /vsmpstats status.");
                } else {
                    startSync();
                    sender.sendMessage("Collecting players and sending them to the website. See /vsmpstats status.");
                }
                return true;
            case "reload":
                reloadConfig();
                hookVault();
                startTimer();
                sender.sendMessage("VSMPStats reloaded. Settings " + (configured() ? "look complete." : "are still incomplete (url / key)."));
                return true;
            default:
                sender.sendMessage("VSMPStats: " + lastResult + ". Balance source: " + (economy != null ? "Vault" : "none") + ". Use /vsmpstats sync or /vsmpstats reload.");
                return true;
        }
    }
}
