"""Regenerate the small demo PDF with embedded fonts for reliable PDF.js rendering."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'lessons/sample-lesson/lesson.pdf'
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
REGULAR = FONT_DIR / 'DejaVuSans.ttf'
BOLD = FONT_DIR / 'DejaVuSans-Bold.ttf'
if not REGULAR.exists() or not BOLD.exists():
    raise SystemExit('Install DejaVu Sans fonts before regenerating the sample PDF.')

pdfmetrics.registerFont(TTFont('DemoSans', str(REGULAR)))
pdfmetrics.registerFont(TTFont('DemoSans-Bold', str(BOLD)))
PAGE_W, PAGE_H = letter
INK = colors.HexColor('#183d35')
GREEN = colors.HexColor('#166b52')
MUTED = colors.HexColor('#687a71')
PAPER = colors.HexColor('#fff7e9')
CARD = colors.HexColor('#fffdf8')
BORDER = colors.HexColor('#e7d1b0')
RED = colors.HexColor('#ec5a50')
YELLOW = colors.HexColor('#f7c53e')
ORANGE = colors.HexColor('#f29b43')
LEAF = colors.HexColor('#6baa68')

c = canvas.Canvas(str(OUT), pagesize=letter, pageCompression=1)
c.setTitle('Demo: My fruit basket')
c.setAuthor('Interactive Learning Demo')
c.setSubject('Demo lesson with embedded fonts for PDF display testing')


def text(x, y, value, size=11, color=INK, bold=False):
    c.setFillColor(color)
    c.setFont('DemoSans-Bold' if bold else 'DemoSans', size)
    c.drawString(x, y, value)


def centered(x, y, value, size=11, color=INK, bold=False):
    c.setFillColor(color)
    c.setFont('DemoSans-Bold' if bold else 'DemoSans', size)
    c.drawCentredString(x, y, value)


def background(page_title, subtitle, page_num):
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    text(44, 735, page_title, 24, INK, True)
    text(46, 709, subtitle, 10.5, GREEN)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.line(44, 692, PAGE_W - 44, 692)
    c.setFillColor(MUTED)
    c.setFont('DemoSans', 8)
    c.drawRightString(PAGE_W - 44, 28, f'Fruit Basket  •  Page {page_num}')


def apple(cx, cy, scale=1):
    c.setFillColor(RED)
    c.circle(cx - 13 * scale, cy, 25 * scale, fill=1, stroke=0)
    c.circle(cx + 13 * scale, cy, 25 * scale, fill=1, stroke=0)
    p = c.beginPath(); p.moveTo(cx - 36 * scale, cy + 4 * scale); p.curveTo(cx - 42 * scale, cy - 28 * scale, cx - 12 * scale, cy - 35 * scale, cx, cy - 28 * scale); p.curveTo(cx + 12 * scale, cy - 35 * scale, cx + 42 * scale, cy - 28 * scale, cx + 36 * scale, cy + 4 * scale); p.close()
    c.drawPath(p, fill=1, stroke=0)
    c.setStrokeColor(colors.HexColor('#79533a')); c.setLineWidth(3 * scale); c.line(cx, cy + 23 * scale, cx + 3 * scale, cy + 42 * scale)
    c.setFillColor(LEAF); c.ellipse(cx + 2 * scale, cy + 36 * scale, cx + 22 * scale, cy + 46 * scale, fill=1, stroke=0)


def banana(cx, cy, scale=1):
    c.setStrokeColor(YELLOW); c.setLineWidth(24 * scale); c.setLineCap(1)
    p = c.beginPath(); p.moveTo(cx - 44 * scale, cy + 18 * scale); p.curveTo(cx - 24 * scale, cy - 28 * scale, cx + 22 * scale, cy - 30 * scale, cx + 45 * scale, cy + 12 * scale)
    c.drawPath(p, stroke=1, fill=0)
    c.setStrokeColor(colors.HexColor('#ad8125')); c.setLineWidth(3 * scale); c.line(cx - 47 * scale, cy + 21 * scale, cx - 40 * scale, cy + 24 * scale); c.line(cx + 41 * scale, cy + 17 * scale, cx + 48 * scale, cy + 21 * scale)


def orange(cx, cy, scale=1):
    c.setFillColor(ORANGE); c.circle(cx, cy, 31 * scale, fill=1, stroke=0)
    c.setFillColor(LEAF); c.ellipse(cx + 1 * scale, cy + 28 * scale, cx + 19 * scale, cy + 37 * scale, fill=1, stroke=0)

# Page 1
background('My fruit basket', 'Mon panier de fruits  •  Look, listen and learn', 1)
c.setFillColor(CARD); c.roundRect(42, 414, PAGE_W - 84, 220, 20, fill=1, stroke=0)
centers = [153, 306, 459]
apple(centers[0], 526, .96); banana(centers[1], 527, 1.02); orange(centers[2], 526, 1.08)
for x, en, fr in zip(centers, ['APPLE', 'BANANA', 'ORANGE'], ['POMME', 'BANANE', 'ORANGE']):
    centered(x, 463, en, 13, INK, True)
    centered(x, 444, fr, 9, MUTED)
text(50, 365, 'Try the activities marked on this page.', 13, GREEN, True)
text(50, 342, 'Choose an answer, listen to a sound and write a fruit name.', 9.5, MUTED)
c.setStrokeColor(BORDER); c.setLineWidth(1.5); c.roundRect(50, 112, PAGE_W - 100, 180, 12, fill=0, stroke=1)
text(68, 260, 'I can name three fruits!', 13, INK, True)
text(68, 235, 'Apple  •  Banana  •  Orange', 10, MUTED)
text(68, 200, 'Use the activity buttons below the page to practise.', 9, MUTED)
c.showPage()

# Page 2
background('Look and match', 'Associe chaque fruit à son nom', 2)
c.setFillColor(CARD); c.roundRect(42, 360, PAGE_W - 84, 270, 20, fill=1, stroke=0)
centers = [153, 306, 459]
apple(centers[0], 535, .78); banana(centers[1], 535, .8); orange(centers[2], 535, .85)
for x, label in zip(centers, ['A. ORANGE', 'B. BANANA', 'C. APPLE']):
    c.setStrokeColor(BORDER); c.roundRect(x - 55, 438, 110, 38, 8, fill=0, stroke=1)
    centered(x, 452, label, 9.5, INK, True)
text(50, 318, 'Match each picture to the correct word.', 12, GREEN, True)
text(50, 295, 'Then add your own drawing or note on the page.', 9.5, MUTED)
c.setStrokeColor(BORDER); c.roundRect(50, 110, PAGE_W - 100, 145, 12, fill=0, stroke=1)
text(68, 222, 'Try it yourself', 12, INK, True)
text(68, 195, 'Look at the pictures carefully.', 9.5, MUTED)
text(68, 174, 'Say each word aloud, then complete the matching activity below.', 9.5, MUTED)
c.showPage()

# Page 3
background('My fruit note', 'Écris et dessine ton fruit préféré', 3)
text(50, 640, 'My favourite fruit is:', 14, GREEN, True)
c.setStrokeColor(BORDER); c.setLineWidth(1.4); c.line(50, 608, PAGE_W - 50, 608)
text(50, 565, 'Draw it in the open space below.', 11, INK)
c.setFillColor(CARD); c.setStrokeColor(BORDER); c.setLineWidth(1.2); c.roundRect(44, 140, PAGE_W - 88, 385, 15, fill=1, stroke=1)
text(62, 490, 'My drawing', 10, MUTED)
c.setStrokeColor(colors.HexColor('#e8e4d9')); c.setLineWidth(.5)
for y in range(180, 475, 28): c.line(62, y, PAGE_W - 62, y)
text(50, 92, 'Your work is saved on this device when you press Save.', 9, MUTED)
c.save()
print(f'Wrote {OUT}')
