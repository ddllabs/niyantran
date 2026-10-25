import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeNewsImage from './HomeNewsImage.jsx';
it('fits publisher generic artwork completely inside the unchanged image rectangle', () => {
  const html = renderToStaticMarkup(<HomeNewsImage className="nh-hero-img" src="https://nter.news/assets/images/article-default.svg" />);
  expect(html).toContain('class="nh-hero-img"');
  expect(html).toContain('object-fit:contain');
  expect(renderToStaticMarkup(<HomeNewsImage src="https://nter.news/assets/uploads/photo.webp" />)).not.toContain('object-fit:contain');
});
