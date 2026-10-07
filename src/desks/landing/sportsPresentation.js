import { DESK_VISUALS } from './deskImages.js';
const visual=DESK_VISUALS.sports;
const lines=html=>html.replace(/<\/?span>/g,'').split('<br>');
const module=feature=>({tier:'sports',feature,title:feature,configured:true});
const groups=[
  {id:'cricket',name:'Cricket & Fixtures',short:'Cricket & Fixtures',description:'Cricket reporting and fixture/results events for four configured world leagues. No live score stream or universal league coverage.',modules:[module('Cricket Wire'),module('Fixtures & Results — World Leagues')]},
  {id:'football',name:'Football Desk',short:'Football Desk',description:'BBC football reporting and ISL fixtures from ESPN or TheSportsDB.',modules:[module('Football Wire'),module('ISL Tracker')]},
  {id:'india',name:'Indian Sport & Governance',short:'Indian Sport & Governance',description:'Selected Indian sports reporting; the governance register is not yet available in the existing adapter.',modules:[module('Indian Sports Wire'),module('Sports Governance & Policy')]},
  {id:'business',name:'Business & Athletes',short:'Business & Athletes',description:'Wikidata Indian league ownership and athlete identities. Rights valuations, rankings and endorsements are not supplied.',modules:[module('Sports Business & Media Rights'),module('Athlete Index')]},
];
export const SPORTS_PRESENTATION={id:'sports',name:'Sports',title:lines(visual.title),description:visual.desc,image:visual.image,imageLabel:visual.label,heading:visual.heading,groups:groups.map((group,index)=>({...group,image:visual.images[index],title:lines(visual.titles[index]),cardDescription:index===2 ? 'Indian sports reporting; policy coverage unavailable.' : index===3 ? 'Indian league/owner observations and athlete identities.' : visual.summaries[index]}))};
