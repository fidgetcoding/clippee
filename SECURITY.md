# Security

Found a way Clippee could leak your API key, touch a document you didn't ask him to, or do anything else he shouldn't? Please tell me privately before you tell anyone else.

- **Preferred:** the **Report a vulnerability** button on this repo's [Security tab](https://github.com/fidgetcoding/clippee/security). It opens a private advisory only you and I can see.
- **Or email:** nate@lorecraft.io

Include what you found, how to reproduce it, and what it lets someone do. I'll reply within a few days and credit you in the fix unless you'd rather stay anonymous.

His History keeps short snippets of your doc (the text he changed, what he wrote, and a few words either side) in this browser's local extension storage, per doc, so you can undo later. It's never synced and never sent anywhere. Clear it from the History screen.

Your Claude API key lives only in the extension's service worker and is sent only to `api.anthropic.com`. Anything that gets it into a web page, a log or another host is exactly what I want to hear about.
