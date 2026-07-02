import argparse
import base64
import io
import json
import sys

import fitz
from PIL import Image


def parse_pages(raw_value: str):
    if not raw_value:
        return []
    pages = []
    for part in raw_value.split(","):
        value = part.strip()
        if not value:
            continue
        page_number = int(value)
        if page_number > 0:
            pages.append(page_number)
    return pages


def render_page(page, dpi: int):
    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    mode = "RGB" if pixmap.n < 4 else "RGBA"
    image = Image.frombytes(mode, [pixmap.width, pixmap.height], pixmap.samples)
    if image.mode != "RGB":
        image = image.convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85, optimize=True)
    return {
        "width": image.width,
        "height": image.height,
        "mimeType": "image/jpeg",
        "dataBase64": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--pages", default="")
    parser.add_argument("--dpi", default="180")
    args = parser.parse_args()

    pages = parse_pages(args.pages)
    dpi = max(72, min(240, int(args.dpi)))

    document = fitz.open(args.input)
    if not pages:
        pages = list(range(1, document.page_count + 1))

    rendered = []
    for page_number in pages:
        if page_number < 1 or page_number > document.page_count:
            continue
        page = document.load_page(page_number - 1)
        rendered_page = render_page(page, dpi)
        rendered.append(
            {
                "pageNumber": page_number,
                "width": rendered_page["width"],
                "height": rendered_page["height"],
                "mimeType": rendered_page["mimeType"],
                "dataBase64": rendered_page["dataBase64"],
            }
        )

    sys.stdout.write(json.dumps({"pages": rendered}))


if __name__ == "__main__":
    main()
