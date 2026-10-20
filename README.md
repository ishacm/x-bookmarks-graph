# X Bookmarks Graph for Obsidian

Save the X posts you have bookmarked as linked notes in Obsidian, then explore them in a visual graph.

- Free and local
- No X API key
- No paid service
- No X password or cookies shared with the plugin
- Obsidian desktop only

## Start in 5 steps

### 1. Install the Obsidian plugin

Install **X Bookmarks Graph** from Obsidian's Community Plugins directory and enable it.

During the public beta, download the plugin files from the latest GitHub release and place `main.js`, `manifest.json`, and `styles.css` in:

`Your vault/.obsidian/plugins/x-bookmarks-graph/`

### 2. Install the browser companion

Download `X-Bookmarks-Chrome-Extension.zip` from the latest release and unzip it. Open `chrome://extensions`, switch on **Developer mode**, select **Load unpacked**, and choose the unzipped folder.

### 3. Pair it with Obsidian

Keep Obsidian open. Go to **Settings → X Bookmarks Graph**, switch on **Receive from browser**, and copy the pairing code. Keep the port set to `27123`.

### 4. Send your bookmarks

Open [x.com/i/history](https://x.com/i/history) or [x.com/i/bookmarks](https://x.com/i/bookmarks), reload once, and scroll through the posts you want to save. Open the browser companion, paste the pairing code, and select **Send captured posts**.

### 5. Explore in Obsidian

Open **X Bookmarks → Dashboard** in your vault. To see the interactive graph, select the bookmark icon in Obsidian's left ribbon or run **X Bookmarks Graph: Open bookmark graph** from the command palette.

## What gets created

Your vault receives ordinary Markdown notes grouped into:

- Tweets
- Authors
- Topics
- External domains
- A dashboard and interactive graph

Sending the same posts again does not create duplicates.

## Privacy

Everything stays on your computer. The companion reads only the X posts displayed in the bookmark/history tab and sends them to Obsidian only when you press **Send**. The local receiver accepts connections only from your computer and protects imports with the pairing code.

## Quick troubleshooting

- **Nothing captured:** Reload the X page after installing or updating the companion, then scroll again.
- **Could not connect:** Keep the Obsidian desktop app open and confirm **Receive from browser** is enabled.
- **Incorrect pairing code:** Copy the newest code from the plugin settings and paste it again.

## Limitations

The companion can save only the posts you scroll past and X displays. X may change its page layout in the future, which can temporarily affect capture. Deleted X bookmarks are not automatically removed from your vault.

## License

MIT. X and Obsidian are trademarks of their respective owners. This independent project is not endorsed by either company.
