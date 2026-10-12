# Synthetic SPECIMEN ID images for testing (fictional people; layouts are simplified, not copies of real cards).
import json, sys, os, random
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = sys.argv[1]
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
def F(p, s): return ImageFont.truetype(p, s)

def mrz_cd(s):
    v = lambda c: 0 if c == '<' else int(c) if c.isdigit() else ord(c) - 55
    return str(sum(v(c) * [7, 3, 1][i % 3] for i, c in enumerate(s)) % 10)

def card(w=1700, h=1070, bg=(242, 242, 236)):
    im = Image.new('RGB', (w, h), bg); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 120], fill=(27, 42, 107))
    return im, d

def philid_front(p):
    im, d = card()
    d.text((40, 25), 'REPUBLIKA NG PILIPINAS', font=F(BOLD, 38), fill='white')
    d.text((40, 70), 'Republic of the Philippines', font=F(SANS, 26), fill='white')
    d.text((40, 140), 'PAMBANSANG PAGKAKAKILANLAN', font=F(BOLD, 40), fill=(27, 42, 107))
    d.text((40, 190), 'Philippine Identification Card', font=F(SANS, 32), fill=(27, 42, 107))
    d.rectangle([40, 260, 400, 700], outline=(120, 120, 120), width=4); d.text((120, 450), 'PHOTO', font=F(SANS, 40), fill=(150, 150, 150))
    x = 460; y = 260
    d.text((x, y), p['pcn'], font=F(BOLD, 44), fill='black'); y += 80
    for lab, val in [('Apelyido/Last Name', p['last']), ('Mga Pangalan/Given Names', p['first']), ('Gitnang Apelyido/Middle Name', p['middle']), ('Petsa ng Kapanganakan/Date of Birth', p['dob_text']), ('Tirahan/Address', p['address'])]:
        d.text((x, y), lab, font=F(SANS, 26), fill=(80, 80, 80)); y += 34
        d.text((x, y), val, font=F(BOLD, 38), fill='black'); y += 64
    d.text((1300, 980), 'SPECIMEN', font=F(BOLD, 40), fill=(200, 40, 40))
    return im

def philid_back(p, qr_payload):
    im, d = card()
    d.text((40, 30), 'PHILSYS', font=F(BOLD, 40), fill='white')
    y = 160
    for lab, val in [('Petsa ng Pagkakaisyu/Date of Issue', p['issued_text']), ('Kasarian/Sex', p['sex']), ('Uri ng Dugo/Blood Type', 'O+'), ('Kalagayang Sibil/Marital Status', 'MARRIED'), ('Lugar ng Kapanganakan/Place of Birth', 'MANILA')]:
        d.text((40, y), lab, font=F(SANS, 26), fill=(80, 80, 80)); y += 34
        d.text((40, y), val, font=F(BOLD, 36), fill='black'); y += 62
    enc = cv2.QRCodeEncoder.create(); q = enc.encode(qr_payload)
    q = cv2.resize(q, (520, 520), interpolation=cv2.INTER_NEAREST)
    im.paste(Image.fromarray(q).convert('RGB'), (1100, 260))
    d.text((1300, 980), 'SPECIMEN', font=F(BOLD, 40), fill=(200, 40, 40))
    return im

def passport_page(p, break_mrz=False):
    im, d = card(1700, 1200, (236, 240, 246))
    d.text((40, 25), 'REPUBLIKA NG PILIPINAS', font=F(BOLD, 36), fill='white'); d.text((40, 70), 'PASAPORTE / PASSPORT', font=F(SANS, 28), fill='white')
    d.rectangle([40, 160, 400, 620], outline=(120, 120, 120), width=4)
    x = 460; y = 160
    for lab, val in [('Type/Uri', 'P'), ('Passport No./Blg. ng Pasaporte', p['passport']), ('Surname/Apelyido', p['last']), ('Given Names/Mga Pangalan', f"{p['first']} {p['middle']}"),
                     ('Date of Birth/Kapanganakan', p['dob_pp']), ('Date of Issue/Petsa ng Pagkakaloob', p['issue_pp']), ('Valid Until/Valid Hanggang', p['exp_pp'])]:
        d.text((x, y), lab, font=F(SANS, 24), fill=(80, 80, 80)); y += 30
        d.text((x, y), val, font=F(BOLD, 34), fill='black'); y += 52
    sur = p['last'].replace(' ', '<'); giv = f"{p['first']}<{p['middle']}".replace(' ', '<')
    l1 = f"P<PHL{sur}<<{giv}".ljust(44, '<')[:44]
    num = p['passport'].ljust(9, '<'); dob = p['dob_yymmdd']; exp = p['exp_yymmdd']
    pers = '<' * 14
    l2 = num + mrz_cd(num) + 'PHL' + dob + mrz_cd(dob) + p['sex'][0] + exp + mrz_cd(exp) + pers + '<'
    comp = l2[0:10] + l2[13:20] + l2[21:43]
    l2 = l2 + mrz_cd(comp)
    if break_mrz: l2 = l2[:19] + str((int(l2[19]) + 3) % 10) + l2[20:]
    d.rectangle([0, 1000, 1700, 1200], fill=(250, 250, 250))
    d.text((40, 1020), l1, font=F(MONO, 58), fill='black'); d.text((40, 1100), l2, font=F(MONO, 58), fill='black')
    return im

def license_front(p, number=None):
    im, d = card()
    d.text((40, 25), 'REPUBLIC OF THE PHILIPPINES', font=F(BOLD, 36), fill='white'); d.text((40, 70), 'LAND TRANSPORTATION OFFICE', font=F(SANS, 28), fill='white')
    d.text((40, 140), "NON-PROFESSIONAL DRIVER'S LICENSE", font=F(BOLD, 38), fill=(27, 42, 107))
    x = 460; y = 220
    for lab, val in [('Last Name, First Name, Middle Name', f"{p['last']}, {p['first']} {p['middle']}"), ('Date of Birth', p['dob_slash']), ('License No.', number or p['license']), ('Expiration Date', p['lic_exp'])]:
        d.text((x, y), lab, font=F(SANS, 26), fill=(80, 80, 80)); y += 34
        d.text((x, y), val, font=F(BOLD, 38), fill='black'); y += 70
    d.text((1300, 980), 'SPECIMEN', font=F(BOLD, 40), fill=(200, 40, 40))
    return im

def photo(card_im, *, angle=0, blur=0, dark=1.0, glare=False, crop=False, bg=(70, 60, 50), size=(2400, 1800), seed=1):
    """Places the card on a table background like a phone photo."""
    rnd = random.Random(seed)
    canvas = Image.new('RGB', size, bg)
    cw, ch = card_im.size
    scale = 1.25
    c = card_im.resize((int(cw * scale), int(ch * scale)))
    if crop: x, y = -300, 200
    else: x, y = (size[0] - c.size[0]) // 2, (size[1] - c.size[1]) // 2
    canvas.paste(c, (x, y))
    noise = np.array(canvas).astype(np.int16) + np.random.default_rng(seed).normal(0, 4, (size[1], size[0], 3)).astype(np.int16)
    im = Image.fromarray(np.clip(noise, 0, 255).astype(np.uint8))
    if glare:
        g = Image.new('L', size, 0); gd = ImageDraw.Draw(g); gd.ellipse([700, 500, 1700, 1300], fill=255); g = g.filter(ImageFilter.GaussianBlur(60))
        arr = np.array(im).astype(np.float32); m = (np.array(g).astype(np.float32) / 255.0)[..., None]
        arr = arr * (1 - m) + 255 * m * 1.4; im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if dark != 1.0: im = Image.fromarray(np.clip(np.array(im).astype(np.float32) * dark, 0, 255).astype(np.uint8))
    if blur: im = im.filter(ImageFilter.GaussianBlur(blur))
    if angle: im = im.rotate(angle, expand=True)
    return im

def save_jpeg_with_exif(im, path):
    exif = Image.Exif(); exif[0x010F] = 'SpecimenCam'; exif[0x0110] = 'Model S1'; exif[0x9003] = '2026:10:01 10:00:00'
    im.save(path, 'JPEG', quality=90, exif=exif.tobytes())

ana = dict(last='DELA CRUZ', first='ANA', middle='SANTOS', pcn='1234-5678-9012-3456', dob_text='MARCH 14, 1988', dob='1988-03-14',
           address='12 MABINI ST, BRGY 5, QUEZON CITY', issued_text='JUNE 01, 2023', sex='FEMALE', passport='P1234567A',
           dob_pp='14 MAR 1988', issue_pp='10 JAN 2022', exp_pp='09 JAN 2032', dob_yymmdd='880314', exp_yymmdd='320109',
           dob_slash='1988/03/14', license='N01-23-456789', lic_exp='2029/03/14')
qr_ok = json.dumps({'DateIssued': '2023-06-01', 'Issuer': 'PSA', 'subject': {'lName': 'DELA CRUZ', 'fName': 'ANA', 'mName': 'SANTOS', 'DOB': 'March 14, 1988', 'PCN': '1234-5678-9012-3456'}, 'alg': 'EDDSA', 'signature': 'SPECIMEN'})
qr_bad = json.dumps({'DateIssued': '2023-06-01', 'Issuer': 'PSA', 'subject': {'lName': 'REYES', 'fName': 'MARIA', 'mName': 'LOPEZ', 'DOB': 'July 01, 1979', 'PCN': '9999-8888-7777-6666'}, 'alg': 'EDDSA', 'signature': 'SPECIMEN'})

S = lambda name, im: save_jpeg_with_exif(im, os.path.join(OUT, name))
pf, pb = philid_front(ana), philid_back(ana, qr_ok)
S('philid_front_good.jpg', photo(pf, seed=1)); S('philid_back_good.jpg', photo(pb, seed=2))
S('philid_front_blurry.jpg', photo(pf, blur=7, seed=3))
S('philid_front_dark.jpg', photo(pf, dark=0.18, seed=4))
S('philid_front_glare.jpg', photo(pf, glare=True, seed=5))
S('philid_front_upsidedown.jpg', photo(pf, angle=180, seed=6))
S('philid_front_cropped.jpg', photo(pf, crop=True, seed=7))
S('philid_back_qr_mismatch.jpg', photo(philid_back(ana, qr_bad), seed=8))
pp = passport_page(ana); S('passport_good.jpg', photo(pp, seed=9)); S('passport_mrz_broken.jpg', photo(passport_page(ana, True), seed=10))
expired = dict(ana, exp_pp='09 JAN 2020', exp_yymmdd='200109'); S('passport_expired.jpg', photo(passport_page(expired), seed=11))
S('license_good.jpg', photo(license_front(ana), seed=12)); S('license_bad_number.jpg', photo(license_front(ana, 'N0123-45'), seed=13))
mismatch = dict(ana, first='ANNA', dob_text='MARCH 15, 1988'); S('philid_front_mismatch.jpg', photo(philid_front(mismatch), seed=14))
# Screenshot-like: screen-sized PNG with no camera data.
shot = Image.new('RGB', (1920, 1080), (30, 30, 30)); shot.paste(pf.resize((1500, 944)), (210, 68)); shot.save(os.path.join(OUT, 'philid_front_screenshot.png'))
print('ok', len(os.listdir(OUT)))
