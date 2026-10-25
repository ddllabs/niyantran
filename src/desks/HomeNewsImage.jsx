import { useState } from 'react';
import { isPublisherArtwork } from '../lib/homeNews.js';
/** Preserve the card's image area even if the publisher omits or removes its image. */
export default function HomeNewsImage({ src, className = 'nh-news-ph' }) {
  const [failed, setFailed] = useState('');
  return src && failed !== src
    ? <img className={className} src={src} style={isPublisherArtwork(src) ? { objectFit: 'contain' } : undefined} alt="" loading="lazy" onError={() => setFailed(src)} />
    : <div className={className} aria-hidden="true" />;
}
