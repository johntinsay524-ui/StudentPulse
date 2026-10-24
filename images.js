// Pictures are shrunk in the browser and uploaded to Supabase Storage (bucket "pics").
// The database only keeps the picture's web address, not the picture itself.
// Every post/comment picture is saved twice: a small thumbnail (name_t.jpg) for the feed and a larger one for "open full size".

// Old helper: returns a small data URL. Only used for previews now.
function readImage(file, { max = 800, quality = 0.7, square = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not open that image.'));
      img.onload = () => {
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
        const scale = Math.min(1, max / Math.max(sw, sh));
        const c = document.createElement('canvas');
        c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Resize a picture to a JPEG file (Blob). square:true crops the middle (profile photos).
function jpegBlob(file, { max, quality, square = false }) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image.')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
      const scale = Math.min(1, max / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // JPEG has no transparency
      g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      c.toBlob(b => b ? resolve(b) : reject(new Error('Could not process that image.')), 'image/jpeg', quality);
    };
    img.src = url;
  });
}

// Upload a picture and return its public web address.
//   post / comment picture: uploadImage(file)                                   -> full size (max 1280px) + thumbnail (480px)
//   profile photo:          uploadImage(file, { kind: 'a', thumb: false, max: 160, square: true, quality: 0.8 })
// File names are random, so an anonymous post's picture never reveals who uploaded it.
async function uploadImage(file, { kind = 'p', thumb = true, max = 1280, quality = 0.75, square = false } = {}) {
  const name = kind + '/' + crypto.randomUUID();
  const put = async (path, blob) => {
    const { error } = await sb.storage.from('pics').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) throw new Error(error.message);
  };
  await put(name + '.jpg', await jpegBlob(file, { max, quality, square }));
  if (thumb) {
    try { await put(name + '_t.jpg', await jpegBlob(file, { max: 480, quality: 0.7 })); }
    catch (e) { await sb.storage.from('pics').remove([name + '.jpg']); throw e; }
  }
  return sb.storage.from('pics').getPublicUrl(name + '.jpg').data.publicUrl;
}

// Helpers for stored addresses. Old pictures saved as data URLs still work: they have no thumbnail.
const picPath = u => { const i = String(u || '').indexOf('/pics/'); return i < 0 ? null : u.slice(i + 6); };
const thumbOf = u => picPath(u) ? u.replace(/\.jpg$/, '_t.jpg') : u;
async function dropImage(u, thumb = true) {     // best effort; only the uploader is allowed to delete
  const p = picPath(u); if (!p) return;
  try { await sb.storage.from('pics').remove(thumb ? [p, p.replace(/\.jpg$/, '_t.jpg')] : [p]); } catch {}
}
