# VSMPStats: automatic leaderboard updates

A small Minecraft plugin that sends every player's **balance, kills, deaths and playtime** to your website every few minutes, so the leaderboard stays up to date by itself.

## 1. Get the plugin file

You don't need Java. GitHub builds it for you:

1. Open your repository on GitHub, then the **Actions** tab.
2. Click **Build the VSMPStats plugin** (left side), then the newest run (green tick).
3. At the bottom of the run page, under **Artifacts**, download **VSMPStats-plugin**. Unzip it: inside is `VSMPStats.jar`.

If there is no run, click **Run workflow** on that page.

## 2. Put it on the Minecraft server

1. Upload `VSMPStats.jar` into the server's **plugins** folder (panel → Files → plugins).
2. Restart the server once. This creates `plugins/VSMPStats/config.yml`.

## 3. Connect it to the website

1. In Render → your service → **Environment**, add `LEADERBOARD_KEY` with a long secret (at least 16 characters). Save.
2. Open `plugins/VSMPStats/config.yml` and set:
   - `url:` your site address followed by `/api/leaderboard/update`, for example `https://your-site.onrender.com/api/leaderboard/update`
   - `key:` exactly the same secret as `LEADERBOARD_KEY`
3. Run `/vsmpstats reload` in the server console (or restart).

## 4. Check it

- Run `/vsmpstats sync`, then `/vsmpstats status`. It should say `sent N player(s)`.
- Open the leaderboard page on your site. Players appear within a minute.
- It then updates by itself every `interval-minutes` (5 by default).

## Where the numbers come from

- **Balance:** Vault (works with EssentialsX and most economy plugins). Without Vault, players are ranked by kills and balance stays 0.
- **Kills, deaths, playtime:** Minecraft's own statistics.
- **Clan (optional):** set `clan-placeholder` (needs PlaceholderAPI and a clans plugin).

## If something is wrong

| `/vsmpstats status` says | Meaning |
|---|---|
| `the website said HTTP 401` | The `key` doesn't match `LEADERBOARD_KEY` exactly. |
| `the website said HTTP 503` | `LEADERBOARD_KEY` isn't set on the site (or is under 16 characters). |
| `could not reach the website` | Check the `url` for typos (it must start with `https://`). |
| `Balance source: none` | Vault or an economy plugin isn't installed. |

Players only appear if they joined within `active-days` days (30 by default).
