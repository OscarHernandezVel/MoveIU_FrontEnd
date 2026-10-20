"""Verifica el front en navegadores móviles *emulados* (Chromium con el tamaño, la densidad y el agente de usuario de
iPhone, Pixel y un Android pequeño) y con poco brillo (filtro de brillo sobre la página).

    npm run build && npx next start -p 3111 &     # en otra terminal
    python3 tools/verificar_movil.py http://localhost:3111 salida/

Comprueba: sin errores de consola, sin desplazamiento horizontal, controles táctiles de 44 px, el modo demostración, el recorrido
completo, el plano de cabina vertical y los tres temas. Guarda capturas normales y con brillo reducido.
NOTA: usa el motor de Chromium; Safari (WebKit) y Firefox no se prueban aquí.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from playwright.async_api import Page, async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3111"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "capturas")
OUT.mkdir(parents=True, exist_ok=True)

DEVICES = {
    "iphone13": dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                     user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
    "pixel7": dict(viewport={"width": 412, "height": 915}, device_scale_factor=2.6, is_mobile=True, has_touch=True,
                   user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"),
    "android_pequeno": dict(viewport={"width": 360, "height": 640}, device_scale_factor=2, is_mobile=True, has_touch=True,
                            user_agent="Mozilla/5.0 (Linux; Android 9; SM-J400F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/20.0 Chrome/106.0.0.0 Mobile Safari/537.36"),
}
problems: list[str] = []


def check(ok: bool, text: str) -> None:
    print(("  ok  " if ok else "  FALLA ") + text)
    if not ok:
        problems.append(text)


async def overflow(page: Page) -> int:
    """Píxeles que algún elemento visible se sale por la derecha (salvo los carriles que se desplazan a propósito).
    Se miden los elementos y no solo scrollWidth: un celular emulado ensancha la ventana y esconde el problema."""
    return await page.evaluate(
        """() => { const w = window.innerWidth; let worst = 0;
          for (const e of document.body.querySelectorAll('*')) {
            if (e.closest('.routes, .maplibregl-map, svg:not(.cabin):not(.flow), [data-scroll]')) continue;
            const r = e.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) worst = Math.max(worst, Math.round(r.right - w));
          }
          return Math.max(worst, document.documentElement.scrollWidth - w); }"""
    )


async def small_targets(page: Page) -> list[str]:
    return await page.evaluate(
        """() => [...document.querySelectorAll('a[href],button,select,input[type=checkbox],[role=link]')]
          .map(e => ({ e, box: (e.tagName === 'INPUT' && e.closest('label') ? e.closest('label') : e).getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && box.height > 0 && (box.height < 43.5 || box.width < 43.5))
          .map(({ e }) => e)
          .filter(e => !e.closest('.maplibregl-ctrl') && !(e.tagName==='A' && e.closest('p,li') && !e.classList.contains('btn')))
          .map(e => (e.tagName + ' ' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)))"""
    )


async def dim(page: Page, shot: Path) -> None:
    """Captura con brillo reducido (~30 %): simula una pantalla de celular casi apagada."""
    await page.add_style_tag(content="html{filter:brightness(.3)!important}")
    await page.screenshot(path=str(shot))
    await page.add_style_tag(content="html{filter:none!important}")


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for name, opts in DEVICES.items():
            print(f"== {name}")
            context = await browser.new_context(**opts, color_scheme="dark")
            page = await context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)

            await page.goto(BASE + "/")
            await page.wait_for_selector(".bus-pin", timeout=15000)
            check(await page.locator(".demo-banner").count() == 1, "aviso de modo demostración visible")
            check(await overflow(page) <= 0, "sin desplazamiento horizontal en el mapa")
            await page.wait_for_timeout(1500)
            await page.screenshot(path=str(OUT / f"{name}_mapa.png"))
            await dim(page, OUT / f"{name}_mapa_brillo30.png")
            bad = await small_targets(page)
            check(not bad, f"controles táctiles de 44 px o más {bad[:4]}")

            # temas
            for theme in ("day", "night", "contrast"):
                await page.select_option("select[aria-label='Tema de color']", theme)
                got = await page.evaluate("document.documentElement.getAttribute('data-theme')")
                check(got == theme, f"tema {theme} aplicado")
                await page.screenshot(path=str(OUT / f"{name}_tema_{theme}.png"))

            # plano de cabina vertical
            await page.select_option("select[aria-label='Tema de color']", "night")
            await page.locator(".bus-pin").first.click(force=True)  # el marcador se mueve: no esperar a que se quede quieto
            await page.wait_for_selector("svg.cabin", timeout=10000)
            await page.wait_for_timeout(1200)
            check("vertical" in (await page.locator("svg.cabin").get_attribute("class") or ""), "cabina vertical en el celular")
            check(await overflow(page) <= 0, "sin desplazamiento horizontal en la cabina")
            box = await page.locator("svg.cabin").bounding_box()
            seat = await page.locator("svg.cabin rect.seat").first.bounding_box()
            check(box is not None and box["width"] <= opts["viewport"]["width"], "plano dentro de la pantalla")
            check(seat is not None and seat["width"] >= 28, f"sillas legibles ({seat['width']:.0f} px de ancho)" if seat else "sillas")
            await page.screenshot(path=str(OUT / f"{name}_cabina.png"), full_page=True)
            await dim(page, OUT / f"{name}_cabina_brillo30.png")

            # recorrido completo
            await page.goto(BASE + "/recorrido")
            await page.wait_for_selector(".tour-panel .schematic .bus-pin", timeout=15000)
            for step in range(7):
                title = await page.locator("#tour-title").inner_text()
                check(await overflow(page) <= 0, f"paso {step + 1} «{title[:36]}» sin desplazamiento horizontal")
                await page.screenshot(path=str(OUT / f"{name}_paso{step + 1}.png"), full_page=True)
                if step < 6:
                    await page.get_by_role("button", name="Siguiente →").click()
                    await page.wait_for_timeout(300)
            check(await page.get_by_role("link", name="Terminar").count() == 1, "el recorrido termina con «Terminar»")
            check(not errors, f"sin errores de consola {errors[:2]}")
            await context.close()
        await browser.close()
    print("\nRESULTADO:", "todo bien" if not problems else f"{len(problems)} problemas")
    for item in problems:
        print(" -", item)
    sys.exit(1 if problems else 0)


asyncio.run(main())
