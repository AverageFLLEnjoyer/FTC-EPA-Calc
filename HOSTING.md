# Hosting on GitHub (free), updating automatically

You need a GitHub account. Everything below is in the browser except step 2.

## 1. Create the repository
1. On github.com click **New repository**. Name it e.g. `ftc-epa`.
2. Choose **Public**. (GitHub Pages is free for public repos. Your API key is NOT in the code, so this is safe.)
3. Click **Create repository**.

## 2. Upload the project
Easiest, no git needed: on the new repo page click **uploading an existing file**, then drag in the CONTENTS of the `ftc-epa` folder (`server.js`, `export.js`, `public/`, `.github/`, etc.), and click **Commit changes**.

Important: the `.github` folder must go up too. Windows hides folders starting with a dot in some views, and dragging can skip it. If after uploading you can't see `.github/workflows/update.yml` in the repo, use **Add file > Create new file**, type `.github/workflows/update.yml` as the name, and paste in that file's contents.

(With git instead: `git init`, `git add .`, `git commit -m "first"`, `git branch -M main`, `git remote add origin <your repo url>`, `git push -u origin main`.)

Do not upload the `cache` folder. It is ignored by `.gitignore` if you use git; if you drag-and-drop, just leave it out.

## 3. Add your TOA key as a secret
1. In the repo go to **Settings > Secrets and variables > Actions**.
2. Click **New repository secret**.
3. Name: `TOA_KEY`. Value: your key. Click **Add secret**.

## 4. Turn on Pages
**Settings > Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.

## 5. Run it
1. Open the **Actions** tab. If it asks, click the button to enable workflows.
2. Click **Update site** on the left, then **Run workflow** (green button).
3. Wait for it to finish (a small season takes minutes; a full season the first time can take up to an hour or two because of TOA's rate limit).
4. Your site is at `https://YOUR-USERNAME.github.io/ftc-epa/` (the link also appears in the finished run, under the deploy step).

From then on it rebuilds every 3 hours by itself, and each run only downloads new matches.

## Options (Settings > Secrets and variables > Actions > **Variables** tab)
- `SEASONS`: e.g. `2627` (default) or `2627,2526` for both. The first one is shown by default. More seasons means a longer first run.
- `TOA_RPS`: requests per second to TOA (default 3). Lower it if runs show 429 errors.

## If something goes wrong
- **Run fails with "TOA_KEY is not set"**: the secret name must be exactly `TOA_KEY`.
- **"Season has no matches yet"**: check the season key in `SEASONS`.
- **Failed run, old site still up**: a failed build never replaces the live site. Open the run, expand "Build site", and send me the red text.
- **Scheduled runs stop after a while**: GitHub pauses schedules on repos with no activity for 60 days. Press Run workflow once to wake it.
- **Site shows "Data updated ..." at the bottom** so you can see how fresh it is.
