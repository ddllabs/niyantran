import { useState } from 'react';
/** Preserve the card's image area even if the publisher omits or removes its image. */
export default function HomeNewsImage({ src, className = 'nh-news-ph' }) {
  const [failed, setFailed] = useState('');
  return src && failed !== src
    ? <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
    : <div className={className} aria-hidden="true" />;
}
