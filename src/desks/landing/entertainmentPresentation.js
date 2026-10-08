import { DESK_VISUALS } from './deskImages.js';
const visual=DESK_VISUALS.entertainment;
const lines=html=>html.replace(/<\/?span>/g,'').split('<br>');
const module=(feature,title=feature)=>({tier:'entertainment',feature,title,configured:true});
const groups=[
 {id:'screens',name:'Screens & Streaming',short:'Screens & Streaming',description:'India/US television schedules and Indian film identities with optional reported gross. No complete streaming catalogue or weekend box-office chart.',modules:[module('TV & Streaming Tonight'),module('Box Office Tracker','Indian film identities & reported gross')]},
 {id:'wire',name:'Industry Wire',short:'Industry Wire',description:'Variety and NDTV Movies reporting, with declared Google News Bollywood fallback.',modules:[module('Entertainment News Wire'),module('Bollywood & Film Wire')]},
 {id:'music',name:'Music',short:'Music',description:'India and United States most-played charts, with iTunes fallback. Release dates are not chart freshness and US is not global coverage.',modules:[module('Music Charts — India Top 25'),module('Music Charts — Global Top 25','Music Charts — United States Top 25')]},
 {id:'screen-intelligence',name:'Screen Intelligence',short:'Screen Intelligence',description:'Indian service/studio owner identities and public follower observations. No subscriber tables or composite influence scores.',modules:[module('OTT & Studio Intelligence','OTT & studio owner identities'),module('Celebrity Influence Index','Public follower observations')]},
];
export const ENTERTAINMENT_PRESENTATION={id:'entertainment',name:'Entertainment',title:lines(visual.title),description:visual.desc,image:visual.image,imageLabel:visual.label,heading:visual.heading,groups:groups.map((group,index)=>({...group,image:visual.images[index],title:lines(visual.titles[index]),cardDescription:['India/US schedules and Indian film identities with optional gross.',visual.summaries[1],'India and US most-played charts, with iTunes fallback.','Indian studio identities and public follower observations.'][index]}))};
