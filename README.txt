SPECTRA — installable app (PWA)

Host this folder on any HTTPS web server (GitHub Pages, Netlify, Vercel, Cloudflare Pages, or your own).
Opening the files directly from disk will not install: browsers only allow service workers on https:// (or http://localhost).

1. Upload everything in this folder, keeping the structure.
2. Open  https://<your-host>/VJ%20Fractal.dc.html
3. Install:
   - Chrome / Edge (desktop, Android): the install icon in the address bar, or menu > Install app.
   - iPhone / iPad (Safari): Share > Add to Home Screen.
4. After the first load it opens offline. Microphone and camera still need permission the first time.

Local test:  run  npx serve .  (or  python -m http.server)  in this folder, then open http://localhost:<port>/VJ%20Fractal.dc.html
