# UgaWildVision

A web app that names an animal from a photo, built to support wildlife tourism in Uganda. The model
runs **on your phone, in the browser**; photos are never uploaded. It can be installed to the home
screen and works offline after the first visit.

## Get it on your phone

<img src="icons/qr.png" alt="QR code for UgaWildVision" width="220">

Scan the QR code with your phone's camera, or open
**https://josephwalusimbi-eng.github.io/ugawildlifevision-app/**

- **Android (Chrome):** menu (&#8942;) → **Install app** / **Add to Home screen**
- **iPhone (Safari):** **Share** → **Add to Home Screen**

A printable page with the QR code and these steps is at
[install.html](https://josephwalusimbi-eng.github.io/ugawildlifevision-app/install.html).

## Languages

Animal names can be shown and heard in:

- **Ugandan languages:** Luganda, Runyankole, Rutooro, Ateso (Sunbird AI translation; audio by Sunbird AI
  text-to-speech, except Rutooro, which has no voice yet).
- **Visitor languages:** Kiswahili (Sunbird AI), French, German and Dutch (common names, spoken by the
  phone's own voice). These were chosen from official visitor statistics: each is a main language of
  countries that send at least 2% of Uganda's visitors or of its holiday visitors (Uganda Tourism
  Satellite Account 2023, 2019 data).

Machine-translated names are checked automatically by translating them back to English, and names that fail
are not shown. All names are marked "not yet checked" until a native speaker confirms them.

## Accuracy

On 47 real phone photos taken at the Uganda Wildlife Conservation Education Centre (UWEC), Entebbe, it was
right about 1 time in 5 (zebra and tiger worked well; chimpanzee, birds, lion and buffalo did not).

- Model: YOLOv8n-cls image classifier, 26 classes, exported to ONNX (6 MB), run with
  ONNX Runtime Web (MIT licence, in `vendor/`).
- This repository contains only the app, the model and the name audio, no training images.
