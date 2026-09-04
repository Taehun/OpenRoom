# Navigation menus

The app's Admin API scopes cover products and publications only, so menus
cannot be written from this repository — `write_online_store_navigation` is not
granted. Enter these by hand in **Online Store → Navigation**, or add the scope
and turn this file into script input.

Shopify creates two menus on a new store: `main-menu` (handle `main-menu`) and
`Footer menu` (handle `footer`). The theme's header uses `main-menu`; the
footer columns added by `sections/footer-group.json` use `main-menu` for the
"Shop" column and `footer` for the "Help" column. Keep those handles.

## Main menu (`main-menu`)

Grouped the way a furniture shop groups things, not the way the catalog stores
`productType`. Collection links use the handles `pnpm shop:seed` created.

| Item | Link |
| --- | --- |
| Shop all | `/collections/all` |
| Seating | `/collections/sofa` |
| — Sofas | `/collections/sofa` |
| — Chairs | `/collections/chair` |
| Tables | `/collections/coffee-table` |
| — Coffee tables | `/collections/coffee-table` |
| — Side tables | `/collections/side-table` |
| Storage | `/collections/bookshelf` |
| Lighting | `/collections/floor-lamp` |
| Decor | `/collections/rug` |
| — Rugs | `/collections/rug` |
| — Plants | `/collections/plant` |
| About | `/pages/about` |

Rows beginning with `—` are nested one level under the row above them. A parent
row that also carries a link (Seating, Tables, Decor) points at the first of
its children, so the top-level item is never a dead end.

## Footer menu (`footer`)

| Item | Link |
| --- | --- |
| About | `/pages/about` |
| Shipping | `/pages/shipping` |
| Returns | `/pages/returns` |
| Privacy | `/pages/privacy` |
| Contact | `/pages/contact` |

`/pages/contact` is Shopify's built-in contact page — create it from the
`page.contact` template rather than pasting body copy into it.
