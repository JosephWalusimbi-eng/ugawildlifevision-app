# UgaWildVision

A web app that names an animal from a photo. The model runs **on your phone, in the browser**;
photos are never uploaded. It can be installed to the home screen and works offline after the
first visit.

Early test version: on 47 real phone photos taken at the Uganda Wildlife Conservation Education
Centre (UWEC), Entebbe, it was right about 1 time in 5 (zebra and tiger worked well; chimpanzee,
birds, lion and buffalo did not).

- Model: YOLOv8n-cls image classifier, 26 classes, exported to ONNX (6 MB), run with
  ONNX Runtime Web (MIT licence, in `vendor/`).
- Local-language animal names are shown only after a native speaker has checked them; none are
  verified yet.
- This repository contains only the app and the model, no training images.
