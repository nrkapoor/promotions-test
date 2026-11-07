import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  const heromain = document.createElement('div');
  heromain.className = 'hero-v2-main';
  [...block.querySelector('div:nth-child(1)>div:nth-child(1)').children].forEach((row) => {
    const herocontent = document.createElement('div');
    herocontent.className = 'hero-v2-content';

    const heroimage = document.createElement('div');
    heroimage.className = 'hero-v2-image';
    const herobody = document.createElement('div');
    herobody.className = 'hero-v2-body';

    // Move each child to either heroimage (if picture) or herobody (otherwise)
    while (row.firstElementChild) {
      const child = row.firstElementChild;
      // Use 'contains picture' check for both direct and nested pictures
      if (child.querySelector && child.querySelector('picture')) {
        heroimage.append(child);
      } else {
        herobody.append(child);
      }
    }

    // Append heroimage and herobody (picture first, then all rest) to herocontent
    herocontent.append(heroimage);
    herocontent.append(herobody);
    heromain.append(herocontent);
  });

  // Fix: Use img.getAttribute('src') instead of img.src in case src hasn't resolved properly
  heromain.querySelectorAll('picture > img').forEach((img) => {
    const src = img.getAttribute('src') || img.src;
    const alt = img.getAttribute('alt') || '';
    if (src) {
      img.closest('picture').replaceWith(createOptimizedPicture(src, alt, false, [{ width: '750' }]));
    }
  });
  block.replaceChildren(heromain);
}
