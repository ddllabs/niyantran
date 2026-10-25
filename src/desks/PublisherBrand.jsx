import './publisherBrand.css';
import mark from '../assets/nter-news/nter-news-mark-red.png';
import word from '../assets/nter-news/nter-news-wordmark.png';
import wordWhite from '../assets/nter-news/nter-news-wordmark-white.png';

/** The publisher's official public mark and wordmark, sized within existing labels. */
export default function PublisherBrand() {
  return <span className="nh-publisher-brand" role="img" aria-label="nter.news">
    <img className="nh-publisher-mark" src={mark} width="14" height="14" alt="" />
    <img className="nh-publisher-word nh-publisher-word--light" src={word} width="78" height="8" alt="" />
    <img className="nh-publisher-word nh-publisher-word--dark" src={wordWhite} width="78" height="8" alt="" />
  </span>;
}
