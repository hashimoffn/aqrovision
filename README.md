# AqroVision

## Fayllar
- `index.html` — əsas dashboard, xəritə, külək axınları, torpaq duzluluğu (ECe dS/m) xəritə qatı və indikatoru, AI meyvə/tərəvəz tövsiyələri və hesab interfeysi
- `server.py` — daxili Python backend serveri (hesabların yaradılması, giriş, Google Sign-In və sahə/qeyd fayllarının saxlanması)
- `backend/` — yaradılan istifadəçi hesab faylları (`backend/accounts.json` və `backend/users/<id>.json`)
- `start_server.bat` — Windows-da backend serveri bir kliklə işə salmaq üçün

## İşə salmaq
Terminalda qovluğun içində aşağıdakı əmri işlədin (və ya `start_server.bat` faylını açın):
```bash
python server.py
```
Sonra brauzerdə `http://127.0.0.1:8000` ünvanına daxil olun.

### Real Google OAuth (İstəyə bağlı)
Əgər real Google Cloud OAuth Client ID istifadə etmək istəyirsinizsə, `backend/config.json` faylındakı `googleClientId` sahəsini doldurun və ya `GOOGLE_CLIENT_ID` mühit dəyişənini təyin edin. Boş olduqda daxili Google hesab seçici pəncərəsi aktiv olur və hesab yenə `backend/users/` faylına yazılır.

## Məlumat mənbələri
- **Keçmiş torpaq nəmliyi, yağıntı, temperatur:** NASA POWER (səth, kök zonası, profil nəmliyi).
- **Bu gün, 7 günlük proqnoz və canlı xəritə külək axınları:** Open-Meteo & NASA POWER.
- **Xəritə:** Esri peyk, Google peyk, OpenStreetMap, NASA GIBS qatları, Torpaq Duzluluğu (ECe dS/m) istilik xəritəsi və canlı diaqnostika paneli, Nominatim axtarışı.
