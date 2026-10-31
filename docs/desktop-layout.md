# Fluid desktop layout (preview only)

2026-11-01: at viewport widths of 1100px and above, the header and application use the available viewport width with 24–64px adaptive side padding. The main frame fills at least the viewport height, with the footer below the content. Feature pages no longer retain the old 760/900/1060px fixed content limits. Quiz and result panels keep their focused reading width inside the wider application frame.

Statistics use two columns, with the page title and practice summary spanning both columns. Data management uses three columns below the full-width heading. Layout follows DOM order, preserving keyboard navigation. Below 1100px the existing layout rules remain in effect, including single-column phone layouts and single-screen phone practice.

tests/desktop-layout.cjs checks 56 route/viewport combinations at 390, 1024, 1099, 1100, 1280, 1440, 1920 and 2560px: full-width desktop frame, column placement, footer height and no horizontal overflow. Populated synthetic statistics and 1920px/390px screenshots are inspected in isolated Edge. This simulates available CSS viewport dimensions rather than claiming native F11 or physical-monitor testing.
