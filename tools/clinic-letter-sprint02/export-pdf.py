"""Export the inspected diagram PNG to a single, print-friendly A3 page."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader

root = Path(__file__).resolve().parent
target = root / "output" / "pdf" / "clinic-letter-sprint02.pdf"
target.parent.mkdir(parents=True, exist_ok=True)
page_width, page_height = landscape(A3)
image = ImageReader(str(root / "clinic-letter-preview.png"))
image_width, image_height = image.getSize()
scale = min((page_width - 28) / image_width, (page_height - 28) / image_height)
width, height = image_width * scale, image_height * scale
pdf = canvas.Canvas(str(target), pagesize=(page_width, page_height))
pdf.setTitle("Clinic Letter - Sprint 02 personal BPMN prototype")
pdf.setAuthor("Clinic Letter personal module")
pdf.drawImage(image, (page_width - width) / 2, (page_height - height) / 2,
              width=width, height=height, preserveAspectRatio=True)
pdf.showPage()
pdf.save()
reader = PdfReader(str(target))
assert len(reader.pages) == 1
assert not reader.get_fields()
print("PDF exported: 1 page, A3 landscape, static diagram")
