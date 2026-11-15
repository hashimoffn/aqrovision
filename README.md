# AqroVision

## Fayllar
- `index.html` — dashboard quruluşu
- `style.css`, `extra.css` — dizayn (extra.css xəritə, cədvəl və tab üslubları)
- `app.js` — xəritə (Leaflet), NASA POWER və Open-Meteo sorğuları, qrafiklər

## İşə salmaq
Qovluğu VS Code-da Live Server ilə açın və ya `python -m http.server 8000` işlədib `http://localhost:8000` ünvanına daxil olun. İnternet lazımdır.

## Məlumat mənbələri
- **Keçmiş torpaq nəmliyi, yağıntı, temperatur:** NASA POWER (səth, kök zonası, profil nəmliyi). Məlumatlar adətən 2–7 gün gecikir.
- **Bu gün və 7 günlük proqnoz:** Open-Meteo (NASA POWER proqnoz vermir).
- **Xəritə:** OpenStreetMap, Esri peyk təsviri, axtarış üçün Nominatim.

## Növbəti mərhələ
Bitki sağlamlığı (NDVI) üçün peyk təsviri (məsələn NASA MODIS/HLS), FastAPI backend və hesab sistemi.
