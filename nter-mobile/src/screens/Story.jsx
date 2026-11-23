// One nter.news story: the cover, dek and opening, a link to read it in full on nter.news,
// "Ask AI about this story" and the desk that holds the records behind it.
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { storyAttachment } from '../services/shape.js';
import { deskById, deskImg } from '../data/desks.js';
import { openUrl, shareLink } from '../lib/open.js';
import Icon from '../ui/Icon.jsx';
import { NnLockup, Ph, TabBar } from '../ui/kit.jsx';
import { asset } from '../lib/asset.js';

const glass = { background: 'rgba(0,0,0,.35)', color: '#fff', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' };

export default function Story({ story }) {
  const { pop, push, toast } = useApp();
  const chat = useChat();
  const { openChat } = useStudio();
  const desk = deskById(story.desk) || deskById('national');
  const paras = story.body ? story.body.split(/\n{2,}/).filter(Boolean).slice(0, 4) : [];

  const ask = () => {
    chat.attach({ ...storyAttachment(story), key: `story:${story.id}`, label: story.title, icon: 'news' });
    chat.setDeskContext({ tier: desk.id });
    openChat();
  };
  const share = async () => {
    const r = await shareLink({ title: story.title, text: story.dek, url: story.link });
    if (r === 'copied') toast('Link copied');
  };

  return (
    <div className="view push">
      <div className="sthero">
        <Ph src={story.img} /><div className="fade" />
        <div style={{ position: 'absolute', left: 8, right: 8, top: 6, zIndex: 2, display: 'flex', gap: 6 }}>
          <button type="button" className="ib" style={glass} onClick={pop} aria-label="Back"><Icon name="back" /></button>
          <span style={{ flex: 1 }} />
          <button type="button" className="ib" style={glass} onClick={share} aria-label="Share"><Icon name="share" /></button>
        </div>
        <div className="copy"><span className="tag">{story.category.toUpperCase()}</span><h2>{story.title}</h2></div>
      </div>
      <div className="body">
        <div className="stbody">
          <div className="meta">
            <button type="button" className="nnbrand" onClick={() => openUrl('https://nter.news')} aria-label="nter.news"><NnLockup cls="sm" /></button>
            <span>·</span><span>{story.date.toUpperCase()}{story.mins ? ` · ${story.mins} MIN READ` : ''}</span>
          </div>
          <div className="byline">By <b>{story.author || 'News Desk'}</b> · nter.news</div>
          {story.dek ? <p className="dek">{story.dek}</p> : null}
          {paras.map((p, i) => <p key={i} className="para">{p}</p>)}
          <p className="para ph">The full story is on nter.news.</p>
          <div className="acts">
            <button type="button" className="pbtn sm sec nnread" onClick={() => openUrl(story.link)}><img src={asset('/brand/nter-news-mark.png')} alt="" />Continue reading on nter.news <Icon name="ext" /></button>
            <button type="button" className="pbtn sm" onClick={ask}><Icon name="sparkle" />Ask AI about this story</button>
          </div>
          <div className="k" style={{ marginTop: 18 }}>RESEARCH THIS ON NTER.PRO</div>
          <button type="button" className="rlink" onClick={() => push({ v: 'desk', deskId: desk.id })}>
            <span className="pic"><Ph src={deskImg(desk.image)} /></span>
            <span className="tx"><b>{desk.name} desk</b><span>{desk.groups.length} sectors · {desk.moduleCount} modules · the records behind this story</span></span>
            <Icon name="chev" />
          </button>
        </div>
      </div>
      <TabBar />
    </div>
  );
}
