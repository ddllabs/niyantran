import { useId } from 'react';
import './nationalLandingArtwork.css';

// Original owner-supplied vectors, with instance-safe gradient references.
export default function NationalLandingArtwork({ scene = 'parliament' }) {
  const id = useId().replace(/:/g, '');
  if (scene === 'parliament') return (
    <svg className="bgsvg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g1sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dfe7fb"/>
          <stop offset=".55" stopColor="#f1effa"/>
          <stop offset="1" stopColor="#fbf1e6"/>
        </linearGradient>
        <radialGradient id={`${id}-g1sun`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1360 640) scale(560 440)">
          <stop offset="0" stopColor="#ffe0b3" stopOpacity=".9"/>
          <stop offset=".5" stopColor="#ffe9c9" stopOpacity=".35"/>
          <stop offset="1" stopColor="#ffe9c9" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id={`${id}-g1col`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fbf5ea"/>
          <stop offset=".55" stopColor="#f1e7d5"/>
          <stop offset="1" stopColor="#d9ccb6"/>
        </linearGradient>
        <linearGradient id={`${id}-g1wall`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cdbfa6"/>
          <stop offset=".35" stopColor="#e4d8c3"/>
          <stop offset="1" stopColor="#e9dfcb"/>
        </linearGradient>
        <linearGradient id={`${id}-g1dome`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6efe2"/>
          <stop offset="1" stopColor="#d6c8b0"/>
        </linearGradient>
        <linearGradient id={`${id}-g1ground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3e8d8"/>
          <stop offset="1" stopColor="#f5f5f7"/>
        </linearGradient>
        <linearGradient id={`${id}-g1shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b5535" stopOpacity=".22"/>
          <stop offset="1" stopColor="#6b5535" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <g className="lyr" data-d=".15">
        <rect x="-2400" width="6400" height="720" fill={`url(#${id}-g1sky)`}/>
        <rect x="-2400" width="6400" height="720" fill={`url(#${id}-g1sun)`}/>
      </g>
      <g className="lyr clouds" data-d=".35" fill="#fff" opacity=".9">
        <g transform="translate(330 150) scale(0.85)">
          <ellipse cx="0" cy="0" rx="90" ry="26"/>
          <ellipse cx="-40" cy="-14" rx="46" ry="30"/>
          <ellipse cx="30" cy="-18" rx="56" ry="34"/>
          <ellipse cx="80" cy="-4" rx="40" ry="22"/>
        </g>
        <g transform="translate(900 110) scale(0.75)">
          <ellipse cx="0" cy="0" rx="90" ry="26"/>
          <ellipse cx="-40" cy="-14" rx="46" ry="30"/>
          <ellipse cx="30" cy="-18" rx="56" ry="34"/>
          <ellipse cx="80" cy="-4" rx="40" ry="22"/>
        </g>
        <g transform="translate(1420 230) scale(1.05)">
          <ellipse cx="0" cy="0" rx="90" ry="26"/>
          <ellipse cx="-40" cy="-14" rx="46" ry="30"/>
          <ellipse cx="30" cy="-18" rx="56" ry="34"/>
          <ellipse cx="80" cy="-4" rx="40" ry="22"/>
        </g>
        <g transform="translate(1900 140) scale(0.9)">
          <ellipse cx="0" cy="0" rx="90" ry="26"/>
          <ellipse cx="-40" cy="-14" rx="46" ry="30"/>
          <ellipse cx="30" cy="-18" rx="56" ry="34"/>
          <ellipse cx="80" cy="-4" rx="40" ry="22"/>
        </g>
      </g>
      <rect x="-2400" y="700" width="6400" height="260" fill={`url(#${id}-g1ground)`}/>
      <rect x="-2400" y="958" width="6400" height="600" fill="#f5f5f7"/>
      <g className="lyr" data-d=".6">
        <g transform="translate(600 660) scale(0.8)">
          <ellipse cx="-70" cy="-34" rx="58" ry="40" fill="#c5d1b8"/>
          <ellipse cx="0" cy="-52" rx="70" ry="52" fill="#b7c6a8"/>
          <ellipse cx="80" cy="-30" rx="62" ry="42" fill="#c5d1b8"/>
          <rect x="-4" y="-10" width="8" height="24" fill="#b3a68c"/>
        </g>
        <g transform="translate(1560 660) scale(0.8)">
          <ellipse cx="-70" cy="-34" rx="58" ry="40" fill="#c5d1b8"/>
          <ellipse cx="0" cy="-52" rx="70" ry="52" fill="#b7c6a8"/>
          <ellipse cx="80" cy="-30" rx="62" ry="42" fill="#c5d1b8"/>
          <rect x="-4" y="-10" width="8" height="24" fill="#b3a68c"/>
        </g>
      </g>
      <g className="lyr" data-d=".75">
        <g transform="translate(250 0)">
          <rect x="796" y="322" width="8" height="30" fill="#d6c8b0"/>
          <circle cx="800" cy="318" r="6" fill="#d6c8b0"/>
          <path d="M682 400 A118 60 0 0 1 918 400 Z" fill={`url(#${id}-g1dome)`}/>
          <path d="M690 400 H910 V462 H690 Z" fill="#ece2cf"/>
          <rect x="700" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="716" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="732" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="748" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="764" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="780" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="796" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="812" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="828" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="844" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="860" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="876" y="414" width="5" height="22" fill="#cdbfa6"/>
          <rect x="892" y="414" width="5" height="22" fill="#cdbfa6"/>
          <path d="M450 476 Q800 446 1150 476 L1150 530 Q800 500 450 530 Z" fill={`url(#${id}-g1wall)`}/>
          <rect x="470" y="514" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="506" y="508" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="542" y="503" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="578" y="499" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="614" y="495" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="650" y="492" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="686" y="489" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="722" y="488" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="758" y="486" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="794" y="486" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="830" y="486" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="866" y="487" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="902" y="489" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="938" y="491" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="974" y="494" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="1010" y="497" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="1046" y="502" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="1082" y="507" width="11" height="20" rx="1" fill="#d2c4ab"/>
          <rect x="1118" y="512" width="11" height="20" rx="1" fill="#d2c4ab"/>
        </g>
      </g>
      <g className="lyr" data-d="1">
        <g transform="translate(250 0)">
          <path d="M318 542 Q800 508 1282 542 L1282 700 Q800 666 318 700 Z" fill="#e6dac6"/>
          <path d="M318 542 Q800 508 1282 542 L1282 566 Q800 532 318 566 Z" fill={`url(#${id}-g1shade)`}/>
          <rect x="330.5" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="328.5" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="328.5" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="335.5" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="333.5" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="333.5" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="343.2" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="341.2" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="341.2" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="353.4" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="351.4" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="351.4" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="365.7" y="558" width="4.7" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="363.7" y="554" width="8.7" height="7" rx="1" fill="#efe5d2"/>
          <rect x="363.7" y="686" width="8.7" height="6" fill="#e2d6c0"/>
          <rect x="380.5" y="558" width="5.5" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="378.5" y="554" width="9.5" height="7" rx="1" fill="#efe5d2"/>
          <rect x="378.5" y="686" width="9.5" height="6" fill="#e2d6c0"/>
          <rect x="397.6" y="558" width="6.3" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="395.6" y="554" width="10.3" height="7" rx="1" fill="#efe5d2"/>
          <rect x="395.6" y="686" width="10.3" height="6" fill="#e2d6c0"/>
          <rect x="417.0" y="558" width="7.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="415.0" y="554" width="11.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="415.0" y="686" width="11.1" height="6" fill="#e2d6c0"/>
          <rect x="438.5" y="558" width="7.8" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="436.5" y="554" width="11.8" height="7" rx="1" fill="#efe5d2"/>
          <rect x="436.5" y="686" width="11.8" height="6" fill="#e2d6c0"/>
          <rect x="462.1" y="558" width="8.5" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="460.1" y="554" width="12.5" height="7" rx="1" fill="#efe5d2"/>
          <rect x="460.1" y="686" width="12.5" height="6" fill="#e2d6c0"/>
          <rect x="487.6" y="558" width="9.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="485.6" y="554" width="13.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="485.6" y="686" width="13.1" height="6" fill="#e2d6c0"/>
          <rect x="514.9" y="558" width="9.6" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="512.9" y="554" width="13.6" height="7" rx="1" fill="#efe5d2"/>
          <rect x="512.9" y="686" width="13.6" height="6" fill="#e2d6c0"/>
          <rect x="543.7" y="558" width="10.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="541.7" y="554" width="14.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="541.7" y="686" width="14.1" height="6" fill="#e2d6c0"/>
          <rect x="574.1" y="558" width="10.6" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="572.1" y="554" width="14.6" height="7" rx="1" fill="#efe5d2"/>
          <rect x="572.1" y="686" width="14.6" height="6" fill="#e2d6c0"/>
          <rect x="605.6" y="558" width="11.0" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="603.6" y="554" width="15.0" height="7" rx="1" fill="#efe5d2"/>
          <rect x="603.6" y="686" width="15.0" height="6" fill="#e2d6c0"/>
          <rect x="638.3" y="558" width="11.3" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="636.3" y="554" width="15.3" height="7" rx="1" fill="#efe5d2"/>
          <rect x="636.3" y="686" width="15.3" height="6" fill="#e2d6c0"/>
          <rect x="672.0" y="558" width="11.6" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="670.0" y="554" width="15.6" height="7" rx="1" fill="#efe5d2"/>
          <rect x="670.0" y="686" width="15.6" height="6" fill="#e2d6c0"/>
          <rect x="706.3" y="558" width="11.8" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="704.3" y="554" width="15.8" height="7" rx="1" fill="#efe5d2"/>
          <rect x="704.3" y="686" width="15.8" height="6" fill="#e2d6c0"/>
          <rect x="741.1" y="558" width="11.9" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="739.1" y="554" width="15.9" height="7" rx="1" fill="#efe5d2"/>
          <rect x="739.1" y="686" width="15.9" height="6" fill="#e2d6c0"/>
          <rect x="776.3" y="558" width="12.0" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="774.3" y="554" width="16.0" height="7" rx="1" fill="#efe5d2"/>
          <rect x="774.3" y="686" width="16.0" height="6" fill="#e2d6c0"/>
          <rect x="811.7" y="558" width="12.0" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="809.7" y="554" width="16.0" height="7" rx="1" fill="#efe5d2"/>
          <rect x="809.7" y="686" width="16.0" height="6" fill="#e2d6c0"/>
          <rect x="846.9" y="558" width="11.9" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="844.9" y="554" width="15.9" height="7" rx="1" fill="#efe5d2"/>
          <rect x="844.9" y="686" width="15.9" height="6" fill="#e2d6c0"/>
          <rect x="881.9" y="558" width="11.8" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="879.9" y="554" width="15.8" height="7" rx="1" fill="#efe5d2"/>
          <rect x="879.9" y="686" width="15.8" height="6" fill="#e2d6c0"/>
          <rect x="916.5" y="558" width="11.6" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="914.5" y="554" width="15.6" height="7" rx="1" fill="#efe5d2"/>
          <rect x="914.5" y="686" width="15.6" height="6" fill="#e2d6c0"/>
          <rect x="950.3" y="558" width="11.3" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="948.3" y="554" width="15.3" height="7" rx="1" fill="#efe5d2"/>
          <rect x="948.3" y="686" width="15.3" height="6" fill="#e2d6c0"/>
          <rect x="983.4" y="558" width="11.0" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="981.4" y="554" width="15.0" height="7" rx="1" fill="#efe5d2"/>
          <rect x="981.4" y="686" width="15.0" height="6" fill="#e2d6c0"/>
          <rect x="1015.4" y="558" width="10.6" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1013.4" y="554" width="14.6" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1013.4" y="686" width="14.6" height="6" fill="#e2d6c0"/>
          <rect x="1046.1" y="558" width="10.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1044.1" y="554" width="14.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1044.1" y="686" width="14.1" height="6" fill="#e2d6c0"/>
          <rect x="1075.5" y="558" width="9.6" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1073.5" y="554" width="13.6" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1073.5" y="686" width="13.6" height="6" fill="#e2d6c0"/>
          <rect x="1103.3" y="558" width="9.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1101.3" y="554" width="13.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1101.3" y="686" width="13.1" height="6" fill="#e2d6c0"/>
          <rect x="1129.5" y="558" width="8.5" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1127.5" y="554" width="12.5" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1127.5" y="686" width="12.5" height="6" fill="#e2d6c0"/>
          <rect x="1153.7" y="558" width="7.8" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1151.7" y="554" width="11.8" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1151.7" y="686" width="11.8" height="6" fill="#e2d6c0"/>
          <rect x="1176.0" y="558" width="7.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1174.0" y="554" width="11.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1174.0" y="686" width="11.1" height="6" fill="#e2d6c0"/>
          <rect x="1196.1" y="558" width="6.3" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1194.1" y="554" width="10.3" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1194.1" y="686" width="10.3" height="6" fill="#e2d6c0"/>
          <rect x="1214.0" y="558" width="5.5" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1212.0" y="554" width="9.5" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1212.0" y="686" width="9.5" height="6" fill="#e2d6c0"/>
          <rect x="1229.5" y="558" width="4.7" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1227.5" y="554" width="8.7" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1227.5" y="686" width="8.7" height="6" fill="#e2d6c0"/>
          <rect x="1242.6" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1240.6" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1240.6" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="1252.8" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1250.8" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1250.8" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="1260.4" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1258.4" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1258.4" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <rect x="1265.4" y="558" width="4.1" height="132" fill={`url(#${id}-g1col)`}/>
          <rect x="1263.4" y="554" width="8.1" height="7" rx="1" fill="#efe5d2"/>
          <rect x="1263.4" y="686" width="8.1" height="6" fill="#e2d6c0"/>
          <path d="M306 540 Q800 500 1294 540 L1294 556 Q800 516 306 556 Z" fill="#f3ebdc"/>
          <path d="M306 526 Q800 486 1294 526 L1294 540 Q800 500 306 540 Z" fill="#e9dfcc"/>
          <path d="M306 688 Q800 676 1294 688 L1294 706 Q800 694 306 706 Z" fill="#e6dbc7"/>
          <rect x="730" y="690" width="140" height="8" fill="#ddd1bb"/>
          <rect x="716" y="698" width="168" height="8" fill="#d5c8b1"/>
          <rect x="700" y="706" width="200" height="8" fill="#ccbfa7"/>
        </g>
      </g>
      <g className="lyr" data-d="1.25">
        <g transform="translate(520 700) scale(0.7)">
          <ellipse cx="-70" cy="-34" rx="58" ry="40" fill="#a9bb99"/>
          <ellipse cx="0" cy="-52" rx="70" ry="52" fill="#93a985"/>
          <ellipse cx="80" cy="-30" rx="62" ry="42" fill="#a9bb99"/>
          <rect x="-4" y="-10" width="8" height="24" fill="#b3a68c"/>
        </g>
        <g transform="translate(1590 700) scale(0.7)">
          <ellipse cx="-70" cy="-34" rx="58" ry="40" fill="#a9bb99"/>
          <ellipse cx="0" cy="-52" rx="70" ry="52" fill="#93a985"/>
          <ellipse cx="80" cy="-30" rx="62" ry="42" fill="#a9bb99"/>
          <rect x="-4" y="-10" width="8" height="24" fill="#b3a68c"/>
        </g>
        <path d="M-2400 760 Q800 720 4000 760 L4000 900 L-2400 900 Z" fill="#e9ede0" opacity=".6"/>
      </g>
    </svg>
  );
  if (scene === 'chamber') return (
    <svg className="tile " viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g2`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#dbe6ff"/>
          <stop offset="1" stopColor="#b7c9ff"/>
        </linearGradient>
        <radialGradient id={`${id}-g2l`} cx=".8" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".55"/>
          <stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="240" height="110" fill={`url(#${id}-g2)`}/>
      <rect width="240" height="110" fill={`url(#${id}-g2l)`}/>
      <g transform="translate(168 98)" fill="none" stroke="#1e2a5a" strokeLinecap="round" strokeOpacity=".78">
        <path d="M-64 -8 A64 64 0 0 1 64 -8" strokeWidth="9"/>
        <path d="M-46 -6 A46 46 0 0 1 46 -6" strokeWidth="9"/>
        <path d="M-28 -4 A28 28 0 0 1 28 -4" strokeWidth="9"/>
      </g>
      <rect x="156" y="82" width="24" height="12" rx="3" fill="#1e2a5a" fillOpacity=".85"/>
      <rect className="sweep" x="-60" y="0" width="60" height="110" fill="#fff" fillOpacity=".35"/>
    </svg>
  );
  if (scene === 'ballot') return (
    <svg className="tile " viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g3`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8dfff"/>
          <stop offset="1" stopColor="#c9b6ff"/>
        </linearGradient>
        <radialGradient id={`${id}-g3l`} cx=".8" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".55"/>
          <stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="240" height="110" fill={`url(#${id}-g3)`}/>
      <rect width="240" height="110" fill={`url(#${id}-g3l)`}/>
      <g transform="translate(150 20)">
        <g className="slip">
          <rect x="10" y="0" width="34" height="24" rx="3" fill="#fff"/>
          <path d="M18 12 l6 6 l12 -12" fill="none" stroke="#1e2a5a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <rect x="-16" y="34" width="86" height="56" rx="8" fill="#1e2a5a" fillOpacity=".85"/>
        <rect x="8" y="30" width="38" height="8" rx="3" fill="#fff" fillOpacity=".9"/>
        <rect x="-4" y="54" width="62" height="6" rx="3" fill="#fff" fillOpacity=".3"/>
      </g>
    </svg>
  );
  if (scene === 'microphones') return (
    <svg className="tile " viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs >
        <linearGradient id={`${id}-g1`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d6f0ec"/>
          <stop offset="1" stopColor="#a6dcd3"/>
        </linearGradient>
        <radialGradient id={`${id}-g1l`} cx=".8" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".55"/>
          <stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="240" height="110" fill={`url(#${id}-g1)`}/>
      <rect width="240" height="110" fill={`url(#${id}-g1l)`}/>
      <path d="M130 110 L138 70 H194 L202 110 Z" fill="#1e2a5a" fillOpacity=".85"/>
      <g stroke="#1e2a5a" strokeWidth="3" strokeLinecap="round" strokeOpacity=".85">
        <path d="M152 70 L146 44"/>
        <path d="M166 70 V40"/>
        <path d="M180 70 L186 44"/>
      </g>
      <g fill="#1e2a5a" fillOpacity=".9">
        <rect x="140" y="30" width="10" height="16" rx="5"/>
        <rect x="161" y="26" width="10" height="16" rx="5"/>
        <rect x="182" y="30" width="10" height="16" rx="5"/>
      </g>
      <g className="bars" fill="#fff" fillOpacity=".9">
        <rect x="206" y="30" width="4" height="30" rx="2"/>
        <rect x="214" y="30" width="4" height="30" rx="2"/>
        <rect x="222" y="30" width="4" height="30" rx="2"/>
        <rect x="230" y="30" width="4" height="30" rx="2"/>
      </g>
    </svg>
  );
  if (scene === 'secretariat') return (
    <svg className="tile " viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g5`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffeacb"/>
          <stop offset="1" stopColor="#ffd196"/>
        </linearGradient>
        <radialGradient id={`${id}-g5l`} cx=".8" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".55"/>
          <stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="240" height="110" fill={`url(#${id}-g5)`}/>
      <rect width="240" height="110" fill={`url(#${id}-g5l)`}/>
      <circle className="sun" cx="196" cy="44" r="16" fill="#fff" fillOpacity=".9"/>
      <g fill="#1e2a5a" fillOpacity=".85">
        <path d="M122 110 V72 H222 V110 Z"/>
        <path d="M150 72 V60 H194 V72 Z"/>
        <path d="M158 60 A14 14 0 0 1 186 60 Z"/>
        <rect x="170" y="38" width="3" height="22"/>
      </g>
      <g fill="#fff" fillOpacity=".8">
        <rect x="132" y="82" width="8" height="12"/>
        <rect x="148" y="82" width="8" height="12"/>
        <rect x="188" y="82" width="8" height="12"/>
        <rect x="204" y="82" width="8" height="12"/>
      </g>
    </svg>
  );
  if (scene === 'economy') return (
    <svg className="tile " viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-g6`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe1e7"/>
          <stop offset="1" stopColor="#ffbfcd"/>
        </linearGradient>
        <radialGradient id={`${id}-g6l`} cx=".8" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".55"/>
          <stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="240" height="110" fill={`url(#${id}-g6)`}/>
      <rect width="240" height="110" fill={`url(#${id}-g6l)`}/>
      <g fill="#1e2a5a" fillOpacity=".85">
        <ellipse cx="136" cy="98" rx="12" ry="4"/>
        <ellipse cx="136" cy="92" rx="12" ry="4"/>
        <ellipse cx="136" cy="86" rx="12" ry="4"/>
        <ellipse cx="166" cy="98" rx="12" ry="4"/>
        <ellipse cx="166" cy="92" rx="12" ry="4"/>
        <ellipse cx="166" cy="86" rx="12" ry="4"/>
        <ellipse cx="166" cy="80" rx="12" ry="4"/>
        <ellipse cx="166" cy="74" rx="12" ry="4"/>
        <ellipse cx="196" cy="98" rx="12" ry="4"/>
        <ellipse cx="196" cy="92" rx="12" ry="4"/>
      </g>
      <path className="line" d="M118 78 L146 62 L168 70 L196 40 L226 30" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle className="tip" cx="226" cy="30" r="4" fill="#fff"/>
    </svg>
  );
  return null;
}
