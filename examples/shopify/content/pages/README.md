# Storefront pages

Body copy for the pages the footer links to. These files are the source:
`pnpm shop:content` reads each one, takes the title from its `# Heading` and
the body from everything after it, and upserts the page by handle — provided
the app has `write_online_store_pages`.

Without that scope, enter them by hand in **Online Store → Pages**: create a
page titled by the file's first heading, switch the editor to `</>` (HTML), and
paste the body below it.

Every page here describes the OpenRoom demo store honestly. This is a
demonstration shop, so no page invents a delivery window, a shipping fee, a
returns period, or any other commercial promise the store cannot keep — it says
plainly that nothing ships and nothing is charged. Keep it that way.
