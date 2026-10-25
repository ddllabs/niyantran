# NTER Law batch-5 LIVE steps for decision owner-authorized-20261026-law-batch-5 (approver Vighnesh Shukla,
# relayed in chat by Tamanesh Kauri, 2026-10-26 03:47 IST). Exactly 1,000 IBBI_NCLT 2025 documents in five tranches.
# Self-contained: rebuilds the pinned repo and Node after any runtime reset and re-verifies every hash before a network call.
# prepare(): offline finalize + dry run for all tranches (no credentials).  live(t): read-only reconcile, then submit only
# if every action, chunk total and cost bound matches.  Credentials come from hidden prompts into this process env only;
# never printed, saved or put on a command line.  Reports are never overwritten.
import base64, getpass, hashlib, json, math, os, pathlib, subprocess, sys, tarfile, time, urllib.request
from collections import Counter

REPO_SHA = 'cf3e7533209858dadde08274f49fe996dd7179d5'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
LEGAL = '/content/drive/MyDrive/Data Handover/Legal/v1.1'
STAGE = LEGAL + '/staging/staging-batch5-20261025-2224'
OUT = STAGE + '/authorized-20261026'
SUMMARY_SHA = 'ae80cada1c7c12a9862f0e6501a5e54d3836e9ded058f87dea890b1ac37c77f1'
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
DECISION = 'owner-authorized-20261026-law-batch-5'
APPROVER = 'Vighnesh Shukla (relayed in chat by Tamanesh Kauri, 2026-10-26 03:47 IST)'
KP = 'law:trib:IBBI_NCLT:ibbi_nclt-'
TRANCHES = {
 "T1": {
  "members": [
   "2025__part-00001"
  ],
  "docs": 186,
  "chunks": 6004,
  "create": 186,
  "link": 0,
  "cost_ceiling": 0.319991
 },
 "T2": {
  "members": [
   "2025__part-00002"
  ],
  "docs": 198,
  "chunks": 7367,
  "create": 198,
  "link": 0,
  "cost_ceiling": 0.393792
 },
 "T3": {
  "members": [
   "2025__part-00003",
   "2025__part-00004"
  ],
  "docs": 254,
  "chunks": 8321,
  "create": 254,
  "link": 0,
  "cost_ceiling": 0.44301
 },
 "T4": {
  "members": [
   "2025__part-00005"
  ],
  "docs": 197,
  "chunks": 6513,
  "create": 197,
  "link": 0,
  "cost_ceiling": 0.344911
 },
 "T5": {
  "members": [
   "2025__part-00006"
  ],
  "docs": 165,
  "chunks": 6427,
  "create": 165,
  "link": 0,
  "cost_ceiling": 0.341706
 }
}
KEYS = {
 "T1": "09d8c7913bd7cbf1c,2a744a9a74109efec,8ff39174bc183c55c,9c241a5ee879c100c,a4072e7906dd11b7c,c57ad3ea109819cac,e2b3483f27837ee2c,0e4d06796b83890dc,43089a8ca396ab01c,4be931fabdb13cbdc,5a669a390a9dfbd9c,b19af1adcbfd8ce5c,c8bce7573bf69c8ec,0cea7f96b1ddb8acc,2ba3f43eb53b8c51c,958027fd33d75543c,cbee06d6d0acd750c,0b0a906bf504d846c,113bf78767f75c60c,1b50eb80c9a553f7c,20ee0981f04aa132c,54f09970b79a7f29c,5c032fe59bceeb88c,700c474a28fc4cd7c,c465018edd889e8dc,cd9bffe678e7cb42c,fd10a3de10df84e6c,273628b3c03a3a9ec,2af14eacb912df0dc,4392e1855a355922c,66e8c21a07614ac7c,7df0de6079f42548c,83a6460dc463906cc,9e07e0f4aa191f96c,a3fdb0ab99c88bb5c,bbf935a49edaeaf7c,bcc05ecbe273cb88c,cec3179a47512ae3c,d8b55743fbe9db2ec,1e882f58d1f10167c,520b71a95f338153c,5732e0f4c9c89311c,57b5f7ec594c3da1c,5f36af786377d3c5c,834298e41bbcf8e2c,b6fcf942e32771f3c,c5aa9dc1d51961dcc,d4ac82557cadda2bc,d5d4f139e083be4cc,dcd9d8e1d0d958bbc,e33b6cf7d7b67d21c,6985baf9b87babe6c,7a1bc88a0fbae107c,bf3e2943894aeac2c,39d749be5781d7b7c,6bdf8b98a1a167d3c,6e90ac06f0cc8e3fc,7090acab57ccb942c,d2daeadebdbf546dc,ea866c6514bfe452c,fbc44c73f6cdd4d5c,ea9206aa49afe876c,f6be16a3d8ba72d8c,57d073aef9cd96adc,7a30a51b60f9b661c,97ce46d674769364c,03de21a6fd7e6634c,356da73a6bc6a84ac,67596c5b139fccdcc,95a1c96774aa9fb4c,981471f7111a3014c,a093131ad653b91fc,a50077daf61df8ebc,ce7b1911e63ec6cbc,3beaa79ee59d09f7c,49da23418204a466c,7e7ef39049118cf7c,c697511d0692ba04c,d2f65a67ad6563e9c,55dc345017790b2cc,57d1db12fc1a0f16c,ab2c01b3d9ac1fe6c,ce7389a297878456c,6b91e07519a14c16c,7db458e7c8e290e8c,92b3b0b4a33b353fc,9f7b978b61d14f63c,a88c005404f488ebc,b7594d3f39631206c,051c2bbcabdd4510c,05ea2cfcf3e413c5c,11864dafbe03833fc,1363463c4c9cd246c,2c9c8b3dad05c249c,2fe7a5574e424e15c,40de5889d87bd086c,4327abcc2b7bef08c,6d23f131287ca081c,889e02b56f9d13c7c,cff869c9817f4ba1c,d606846344d439a1c,4d88f00a32c7e4f2c,079d9ca0934098ddc,2204c6eedf676454c,694fe1256eeaa20fc,ab96b4d6e7b362d8c,b31b2e1eea2ae15bc,3617ba8dd40eed84c,5afefaae8b0df927c,8aead69fd343087ac,917dd803a7f814e6c,d8f311b0906d21fcc,dd52b8479fae99b6c,f7edd5d51a76c0d7c,d3b7e4c0751a8f06c,20117a2d472091c4c,2b3431bf9837c163c,85fe870f3a026baec,90b2d17cae3f2c99c,9b434415a52c8727c,ad8ed7ac24923fe2c,ca3ec064c785c688c,e1e2d0a5cb95019dc,ec529fb5761bdc7dc,f56ec007161fc840c,040c20c053097bfec,07ef03a8f4149160c,276696b4277a4e87c,3dadd49f31eb390ec,458bfc1871c36ca8c,9c0585712b6d8853c,a8de8d5d1cf7049dc,b441890a0e4a1c2ec,e84ab822c3991db1c,17d35d7a60d54ec0c,1f4798842625e711c,4cc76abc21b932afc,86991a9f41beefb4c,2304b5eb1d97e7f3c,2546a119d5ed8907c,3f7c518eb1a54c3cc,55d91b8e45aad71bc,67c95edc313d2bbfc,c36e61042e1612b5c,2cacad18a73b9b7ec,318578fbec11e873c,5885f831b5ecf950c,846e3d0016332decc,939917280786a813c,a4dca0a7ad192c6bc,ba36f0ee8baee451c,049d60de3f8bafd0c,0a98aba849c7b6a7c,538c056e4a394a9ec,83c3f2409a8f3698c,baa593892e594e6fc,03f70746de3801dcc,b873d36d882c5a18c,bba1b74bf5be891cc,be61cfa8f82a26d2c,e27836d47d4d7c68c,e8dc8c6dd2bb4a25c,41d69697866076e8c,2be8bdf7d3447268c,36ba89783aa4cdfcc,9e13f7740da28526c,d299569bddf72a67c,06cc8267c30a38bdc,4b6bdab87a00ef12c,53496a483680e2f0c,56cea071dbd5471cc,c3aa2c77b03280a1c,2712beab32c4d764c,70fd4054529cb599c,755639cb1ab12e6fc,ba0e5fe95345a56ec,bf63c1cebea2268ec,cbd72dd15434870ec,d066b13978c6185cc,dd7a839b5eddb180c,f856feb3fb53346fc,f899d39c1394aa4ec,3c8764a27adf8346c,772773294acda030c,06f778f2ca26d94ec,11f30375e8851fcfc",
 "T2": "19a89b80d89b7940c,6c32ad476d9f80aac,7b023dfa318ca76dc,8e4a793ce1f74954c,b672ab743498ccdac,c85b3a9edec7c5dfc,0591d5710d3516dbc,17ff1b1008c08a1ac,3f552a5e04a2182ec,6d38cea918e95901c,89acc0e8e13e1566c,8c9f8d5f3bbd422fc,daeec475254e4aecc,ff6e8a40955c1c50c,6091a6e81936217ec,b1581d0d64579817c,ea6dfa74336a0b3fc,20044c4a74060ffec,215a6b6770e5f1fec,5f19eb28dbfb0dc2c,9dfe368151991560c,cd4e85c3c9839cb9c,28cfb5d154d31320c,bc1f863f4e0ef4e9c,c8462ec9a4c5fb54c,c898a216d15f17ecc,df4652d5b704ffbec,f3f04283cb31ee73c,7be9431c37cac203c,86772ebf908fb169c,a12034fa8bfa3af2c,de285048cd1653b2c,e8d9384969672ad7c,ecaf9d26ef5d7002c,39383e53d2d8ba45c,500e4f0abf741d8dc,85e17aa8b9db8c73c,12638a36b67d9841c,a1f7a894836afe3ac,d4a2f6cf0bfa023ec,059eab0861faede9c,0cacd24359c5fc91c,4532a0109a6e86b6c,6d9156a164c7867cc,7776161b95666b59c,bb517bfbf69f8bc0c,e1c39b6b7d7f4db8c,e85f0cace7149dd7c,80c45e0b94a5edd9c,d680c4de540a702dc,f839477d676c7bbec,2669c85c5f8061fbc,3a35e029cd1a8473c,3ca4b6afc659e0aac,591cde5f886847e5c,72eddc87cf46d416c,76fc45ea9cbd19a0c,77074d62a0639eafc,7ecad08b7410418bc,816cf08751d7539fc,84c62e77c1fc094fc,914756fa59147a26c,a0aa3af8c615bc9bc,b9902daaa24714ddc,bdfb05af60b7a2f2c,db9b7599336171afc,85e507115347cfc3c,b42fea61040dc816c,ded25c8f260ad900c,e46ed0a85d013767c,fcacd31787742094c,0a11d63a6fc21746c,561477188ed06eb7c,8aed13139fc8a16ec,91d7a9999405f879c,c9f606a9986734e0c,102dc10ed341a2c4c,776ba8b95c051224c,a707ad88a321aaa8c,a84b2eab35842ed0c,2f1be2eb0381f90ac,31ba1d1ae7ebd816c,68bad452b493bedbc,a29476970f233528c,c9b66da806973f6bc,4e4f0b3382d69dfcc,6383a45e535adb49c,72b888f57ada5770c,8c98a8c223daa565c,9d99c58151c1d29ac,aed758da85c8bd64c,fd8fde21919ea66cc,04a063efc9a89110c,13565bf5086c6403c,1d6ca3458f37906fc,2d15c49563e89cf1c,30f38800a4724569c,458d97abf51a72f4c,72d874377d1a0545c,bc02146f717542edc,cbb18699874f2668c,f57741c3e23a32efc,8836e815fda6ad03c,9ab011e13181dbf0c,b49ac4ce994f51acc,b5b8c900dbe842c7c,debcf2dd70948a1ac,04a946fe27243c93c,4b15a425bf5890ecc,5e8f9d297f66f758c,66f48a587d5916f3c,713947b79abced02c,7a2649a794d24275c,7d60b04227248e38c,80e0196140e1a3cbc,a22fae456fd1b2a4c,b6f878dfa5ceaf1ac,b7c7a177f46fb0ecc,d2e5588376194294c,d35983811e2fdaa4c,ea4efceb4c783372c,ec77c5095980fb69c,f89a53a7afb536b6c,12748a094c785853c,5eaf7ae4d6318743c,6c5cb25f4eca7b08c,a57866ce9c93eea4c,e37cbe0b4a1a4f8fc,302153a8dc43dc33c,4082129c1e24537fc,80e4e4e3bf5d610fc,8868f38ca24e89b3c,99b8e07cb23b684cc,9e53c0b0a30f3c69c,a905de19b14fe117c,c74efda05aee0a5fc,ed1b8ff2fb0220e6c,10c15f79e058377dc,12e2d944f67cfc62c,2e13e86a339261f2c,38d25cd32471a8d2c,3d7402d9d6d03f7dc,6d1fed957e5bd4e7c,83dbff2ca6374eacc,846a65fff1ccced8c,88fc8e7de2f89c4ec,9dc9a20e981866b4c,c1639ca5d771154cc,003da9ee9a596a99c,817cfaa8fdde6e0dc,d3c36f6ff727d070c,48a3193712114919c,89bb87620053b44dc,a9b8d59a0d0d8b5dc,bce83b677879267cc,cebcd787f40d3a2dc,d4a832c93cae13b5c,ea39e0316c1ec85ec,f0b1005c50fad767c,070c8932e85bef37c,24cb711fab0cf414c,4535ae912d5b7a70c,531df9adb4b8f2c5c,5658234708e2ef04c,b14d21a0ca8030d3c,02e5b4ea46d0b8ebc,1ad41925dfb88712c,93e4446a8e07fdaac,a56c8ce2778d218dc,b290eafef096ed8ec,f78a2f34f665a9f6c,f909dabd691f039ac,3422ae3550b7131bc,4ffd427df5c77bb9c,c890ecf499a32802c,e597ef1cb281bea3c,ebdfd2b39d6be80dc,f6780bd1a0a6c938c,2ac95229c7b008d4c,b7870a7f0ef9d191c,0cf6fa4b277922afc,177bf99e7a4da8b9c,43fadee7bc009c2bc,73f4a17245122f85c,c30bd3151de752c4c,eeead711eff26ce5c,009740de09a9cfb7c,15d9daba8c6b68e5c,1ce3a2ac36e265fbc,23bbcd91f3c29703c,2ba5fce20be38401c,3e86437377646169c,5b3957817bb2931bc,754a3bfc44560c95c,93733626adad0984c,b5e866fc8e23ddfbc,d67ebec5255cc9cdc,d9973507ba3033c3c",
 "T3": "dd84e2e0d5f14700c,fb72c3b1bdbd5f41c,1346107d9257dde2c,21e82e8a023748bbc,2c93394daf0d7c93c,30840b12380a235ac,3b47bbcde12587ebc,49f499f65c789cbbc,53934297cf3f8e72c,8f0d8d4b2911e623c,912a73315fca5819c,b32374e208dfb668c,b611f5c86f5c2e2bc,bede3fe9893e7528c,3bb626e4d119aa36c,3f89608d98300c26c,41f25ee65db0d1f4c,515997ded08b6003c,54463b1a0e7b9462c,54e9b55b4bee16adc,75a5e2b25e636b72c,bf38e2dbb3f76921c,ef031571da20e2d1c,fb6d24518c01dbc3c,599aefa58824a901c,5f8d8675de4ea8f9c,6f149bc435e0aa33c,774f861de79ac920c,83bba8d12dc72576c,a8a549d2f769d7dcc,d80d7b9646e11c97c,df9b3c76fe6a2f1cc,f69ee7292d03200fc,a56b58eb25080fadc,b89c4bf55c7be921c,fd1b66cc4e66a455c,1885cd2bf3414202c,5157d2b29b453d4ac,98911e495079e7c3c,7e7a833d0b1cb39ac,d8351d983672b0ccc,f6a0874e167ae016c,19b7cc1086fd01e7c,236019351788a32dc,4a8a5c8f49f93825c,5272dbe5d5a7c119c,c04933f8ff2c3b10c,dd77472423413035c,ee92043d869e1f40c,fd78a497df7a1950c,12ee0517241b44e4c,4efe8608cb7625f2c,6b9c8633234d9fd0c,72f181e2110847e4c,7e80be52db605ceac,cd86d71a2764df85c,0fb95df4d59bc4d2c,28969c135104516fc,3d33d7d9a53e5399c,5466d185722b75e5c,a00312d3e0f563b5c,e1b7abbfbc09d88cc,f11957fc1f6d8d02c,07d5a77843854492c,2b4ee5935739112ac,337793bac144f723c,4780854fc364d3a0c,57e95939a2f792d6c,7690f66740fe4111c,9feb2df52dfd199ec,be5e77ff7b3177acc,ca7ae485b529e973c,df1c89ae92f3c410c,0d6195946a1b46cac,4c8daec748500ed0c,730de332cd36533ec,f1f51df077ce790ec,0517ef1f1ea73d44c,0a55694b1a2ae01fc,1d8cc84b0236a5d7c,808d13284387db0ac,94f92765c68cc18bc,9b2b75c90bf2b5f9c,b1a87a0170d8cf0dc,dc72dec751bfd5c3c,e52987a539a0e5d9c,12528b7ea4caa6e2c,31d26d36c4781c0dc,78ab8ff99190f6d5c,bb101ce75715e883c,bd492d3f460ef443c,eedcfb1d7959cc5dc,16f147cf817d9e6fc,609b3c6d94b04c6cc,8d33877fc772b237c,b137b9856e860727c,be5023bc7d242a46c,c645b7b2918dfd9bc,1b9a98cf79177b3fc,27ffe532b6bd1e97c,29776b8695205da2c,2d9724c00d2aba99c,41641f42873d996dc,5cb1d38afbe9f572c,5e8ee07e285cea1cc,952c9f6de84cfdffc,99200bd7797a9755c,2b4ab03d1fc7e9c0c,54ef7f7548b53d6ec,e4c200d4646f58d5c,10d094eaaf274515c,1cfead8cb5584958c,9fa2e87be88aba41c,c7ab486c0871686cc,e6394930649bdd0bc,e9e36a896998dcbcc,12fd037e4d9fa0b6c,2b20acc87f0efeb7c,6f2c4f9bd68c2142c,afeb12789cf5d2f1c,3ff5e3a0bc3d14e8c,45a99c90c05544dcc,49e020b314b237dec,4a8942c8ddb7c0c5c,4cd5e4689e7e76f9c,50a7fc537f327e22c,6271622c94715cfec,903b9af1399db02cc,98f7aa1e8a6c35c5c,a226f8672d3750dac,df484b3aad6dfbb4c,eae21b4f99bd59adc,01ab286e738905a4c,051182f62aa05c9ac,113aaf817ae54a19c,22bfd83af761b91ac,378c052a79d90509c,4565ddd5a3c18531c,4f6983150aff8c1bc,6faf58b63462d661c,9c123f58ef37870fc,9f6fe827cb80eb8cc,ad61c7eb0693f16dc,c91e5d1cdbf01b56c,eebd597c4d490a8fc,48315a65c1da2d28c,48a38f8634526a69c,575e922ca3f6f0cec,97a73ef13f67d96cc,e8830092eca371adc,082063e8501cadbdc,a2c9a64ab15b9f98c,cd4b7fad13ecd6c5c,e6df17f208ccc394c,60fee04977d505cec,6a1e00ab50baf0cac,d2d37b1b8f39faf8c,e399917563679d0ac,ebc4382b1e84cd9cc,23768098ded04232c,5354321d06e4d469c,406eae1312cfd4adc,63fbfa1fd0bdb7edc,a8e3af3d24046ee1c,e5dbd8dc0373ec3bc,1447487767ea967bc,1da645ad6ec24589c,07393bf8fb2e5e49c,7d9e2f86b261cbd3c,8acc58d52aba6abdc,f05c309d6fe4e98ac,39b95793cb056793c,95a52be7a4968b02c,9958af6b2eb8e1e8c,a4db87ea1ad64d7cc,f35dda0aa60e902fc,0d6fe485c3342da7c,158bd69f3e7c34e3c,71a62bee1ea71d4ec,2d249f72b566b707c,44891a3005490a7fc,a6f01332e4a9295fc,293fe3658ff3886fc,b44e73999f891758c,01021c5150f6184ac,36caf75154c3b813c,3a2e71309371f9b9c,3fa7b1f904bcbb4fc,9935f254d212648dc,a64cd830e8404788c,b3416fcf95eebcc7c,d87039e96e7747bcc,e0b945f104f377dfc,e0f17fe0be0a0874c,374af57eecfba29fc,6f0f15b8cb5a0d59c,ef650afb41dc2fc7c,216202b4e32d5fadc,5c4a9878377ef032c,8e9f82c3d12bb3b6c,92684093d652c696c,00f0b2600dc0e1e9c,3d66f91235a55647c,43d54b604b985188c,4a89676bfa5c5853c,4ed5f271bf00e350c,5db895392a8f4b5cc,73d047ddd0a4eacac,7b738cb1e8347902c,8a989ee9b2095778c,91f97114af6aa370c,a2724269ff121a75c,a8cea84909cb3ed0c,f853349e6a3f4f58c,03e7f8484a5688dfc,10d64d0b986fc40ec,416e86fa33a8cc76c,46218e0d5dd6742bc,aa5de83ea3823d1ec,cee401dda9a4c9fac,1172dab2d2943e1bc,53cf29a7c61b3427c,7b561fb292703646c,9c8704ad4f3385cac,ae2c8f29addfbe60c,e803f45089eb84e2c,ec970bdc9cf30494c,0292a945dcbcce29c,365bbc7382559b28c,8c051e9d3f12ad1cc,c920fa9d894efa8ec,0262a917223fe7edc,2286039a639e97bfc,39995a0dc9cb7258c,77d2676515454151c,bb21c9e420bc0379c,d0bcfa8f4a297e73c,0564aec5fe2e111bc,13d747075d915c09c,13dddef142260ef4c,34b07b95c8d55264c,4051e3da6430a992c,738315f5484b8ff7c,e427fb919017a823c,ef886e4669f021afc,02c6d513b879715ec,1168b39e2d598309c,141c4c182816cb13c,16945dbf9d33d70bc,1a600cb0a4c71f7fc,1b3197189639ef58c,2483af1845da6757c,4ecc4d9bc4015baac,6ee869b340227ce6c",
 "T4": "829aa436e631d550c,88511108392949b5c,92dbc2ff5b483d95c,9b1dcf979db82f42c,a33344d0e8cede12c,a7387ebd286b37f7c,bd4fdf7eda0bca60c,c48696db18ccc4cfc,c805d927160ece60c,e8dd43a82a0ffa7ec,fa942faada3248d3c,52e6da779b0c7fbac,86cc57039c0f81cfc,a304319bc204f104c,a4b631b6660badd4c,b8e73cfeea90e42ec,e0f1f9941d0750c9c,eeabcbfe0426ea32c,f64e4028bf3d0018c,21a02d1930cb1980c,5a7ad801bc22c135c,986f611517923ebec,0461dacd0dfdf455c,10252045b3b2a2e6c,4b7d200f94f6c7d7c,a80696e283fd50abc,c299cda32eeb9cecc,c8cb7ff2a88772ebc,e41d21a24d6d8461c,ef76aa218e36a2d4c,44f12802de462a76c,54f4c15ef8ed165cc,7e656c490c6aed00c,c8cb617247b4a159c,fcd917da1af31f18c,1f43f0d5f445d83bc,ade07813a476767dc,bfdd15cd16763dcfc,d73c70b3a579e1adc,c1b9fbdfc6f60e45c,ecb70f6b161b5a91c,591ada9624fb66ccc,d04ea6fe89d39abec,ede9a45775cfba51c,f133ebd066b35298c,38252f5195630526c,ab43711d81c70a07c,e74d312f9fe17165c,22f6c0440fb38b95c,a9621c57684e775ac,b0163fba1e03ed87c,c14b3c6dc8a29df6c,c881d7d2445ee924c,d21a43f080b033f0c,db41a043f46be231c,ff905b87d9a4f7c9c,099d85c4c2310ba7c,265594fc85e3ab44c,9420d098bd8f3952c,c406e15c631b45fac,fb1a7a5b2b3d82d4c,10bc1afd7b8728aec,3e7a5256968eb339c,6eb22fdec6798f40c,702403e16a52c0d3c,705bc9b11244d62cc,8e70bf72f0110bfbc,9ffa0975ff0c4618c,bde791d5928d2950c,c02fa91d15efca3ec,f13ce6a57b4a3d18c,0e1ec7ec63d3438ac,3d2a5c0680f17f46c,56f655340464ef5ac,6c2ca2c55c90d44ac,7333816a3e540fd3c,83e619ae2a9ee4ebc,a2bf5f398f12feb4c,b165bec2b50c9a75c,c37f6e7e2974a68fc,055adc1b0cf4dd3fc,0cb1ea84475c5a0fc,1e87d4dba4eef5a9c,4d3da699fbebfe82c,4d927db56bd5f3bdc,57e1c224dc625bcec,8c653699e1178079c,99ebf24af5d223d9c,ffc1f342efd5c8dfc,1dee39f23776a967c,86ae2326ef6e91b6c,91aa0fea260c90f8c,311f585dbbe777c6c,3524863eda6f0a73c,3869814a8fd73b74c,3db5cb2e9c484cc5c,707223f4ca6360c7c,c73a4687e92fc5bec,dd9ec6a8285d36c9c,2ac5bfb3dde62932c,2b139170518fe07ec,2c4778eb0b12b85bc,3531bf880e1fe594c,4ab489257c9ba7f0c,b4cfd8a1bcf8e3b7c,1228a81e0ad6279fc,3245cc747314fae5c,56fb48bbf1ee3c7bc,5900577941c2c3a6c,9599a4867b4123f2c,9d4e8ddd12069caec,9e0196a523b24a74c,d2da65a07b7550efc,d59611613727b3f8c,f5913fcd9c5455edc,105c6986a71b5b7bc,3458dfa7463fbaebc,68c818cf014312e2c,731b803d873a3f7fc,961e7bbe0c3e0dbac,9780ff29084eb4eec,39dc09d68ded003ac,5635f2614430234ec,6b9980a9f17aa55cc,741ee3f6b3154b18c,bde279df2b14b667c,ef9781b67413b0bdc,056db03ecb8e45f9c,0da2be556a20a857c,172367fce497df1ac,1ce378c3479dfbb2c,2a968b91da5494c1c,2e9a46d465531a2fc,457f621fa51543e8c,4c8ef4c0e3e5e8fac,52e64ccd613f8cf8c,58c08fd25ab10db2c,9b43045e5ebde569c,a110665e9f10b5e7c,a3968d91090146f4c,d5aad4a108e6e516c,6bd2482b236a24f3c,7cc4b257228c1a18c,8ee3baf35115c6d9c,d751a0b285c13d33c,e3a05c5f54f289a5c,f3474183b8a4ef4fc,0a44cee92da88b8ec,2e18b2a5fe2fd020c,551f0fdcd6618a94c,9c6c34ad060e2bccc,b1bfc8d4b2d2f327c,d9fe2e69715e6c68c,e29a4ab7df0ce5f2c,e75db1f734116f5dc,28077312007fed22c,d3763064b9e99978c,00ab01524a274feec,4e8233b888caba96c,786a0aa205464e55c,7ade339e8705965ec,7b2dbbe2cb6e86ecc,ba0d37f98e976575c,c5cd4aef13f04e72c,eba8e235215fb666c,21d87db5842445e2c,31991f72a5c3f6ebc,4856c610b6b6683cc,82149569b7c0e401c,8315edfbc43103f8c,95ff632c4bf52eb2c,be2daf1665719461c,cd0e3ca75f24d389c,2a9bf4940afa37a9c,d6045a349cc18e7fc,56bca174bc487525c,91a5ca80598acbdfc,b15fa65ea7cd5a6ec,b36b86500ae1f6c2c,c0bd167717c68117c,e8aeb5178b135d46c,f35e605debf2efcfc,2edbff9a3a93d1c4c,4ab926d613de4d4bc,7790097f107f3e68c,84d65361865c74cfc,9ae01f46804ba645c,cc452ae2aec908bbc,e06d964a17de9164c,0e1fec27ccdf920ec,2ac809c72c8dd845c,3fa43cd4c6ed7cc8c,5d13386fd5923e8ac,9e5fabd70a7e5e06c,d5b144ddd6f0e8c3c,f2334a15e7de6b8dc,003e9a601cf133cbc",
 "T5": "3ba7caf285a32811c,44eed228cdfa006dc,64d7256596ce8cd1c,862d1c5e322fa124c,d7bdef953d6ef271c,34bcbd7e87d9618fc,6d2d047a9729555cc,9d21e4f09208d898c,bdaa6eddf08c773dc,c504660408214497c,cea05cf4da6e308ec,35d5cc7780f8f907c,56c20fc137aaea96c,62c1ce9e78b7a6e3c,9c4e5c5509e14367c,fa8cd565bd9b4ffac,54b90846dcda87c9c,55b1115e7f7ba7a3c,58af1577fff8d66cc,c4a4c590bf0464aec,f01f66f022adb942c,f84001fcfa4c5fa4c,892e56bea3408ca7c,a564b694016ab0adc,cfcb9beea16d9122c,d33e981733caf0fcc,0902093b73c8c3cdc,62829294f8ee4a64c,8a85679f52f1d94cc,b8109daf76267ed8c,c52afc3df0f8bbf5c,c615ef9506f8e9acc,c63ea21eb484917ac,d402ceed9593df29c,77b2790d9641d1a1c,891fa2e9213b0981c,9ec023c5c223877cc,1f03165b4cdbd21cc,264c035d02cca350c,3fa52e02eadb5d37c,4781c82077bcefa9c,48af664e8077b1c4c,54d543140c559025c,5fb62b3f30a36c0dc,74f252134c636127c,83b3b454017320cbc,8993b477fe811417c,908d01c7cde1d06fc,a4dd006b2f1f8c3bc,b9f3762e9e5bcc4ec,c56146a0e6ea8d8dc,cdd3445c1e20c283c,dacf14d8634c4862c,03bd9b43641066afc,142f768aa84337a9c,220f84c1713c40a5c,6d6b6d27fffd98aec,7140369adaee4d5dc,ade6c5038c5ab414c,0cae9b9e64398594c,1701b54f846ec2b7c,a5ad305820ccca0ac,bdfd77212d152fbcc,06cd2df03c032c01c,1874d5a7523d4e71c,279554f070c0ee47c,2d0ac1128754c051c,426b0fc974b2dc46c,4dd7267f588aad30c,53d474aa7a71c393c,72931f06cfd7c482c,7781c5dcdd425022c,7cb64b44a11430c5c,a5a741aa347b7609c,aa92f7d0d38fda4bc,aca0a89d7a8ce304c,fefe5de9ba3a5744c,9077a3893d27c726c,aadcb03292ed555fc,b2e5ef285c46091ac,e3bb4dde22f683b3c,063fb00ba0a22bb7c,268d02af32b91c0ac,9aa981d77f12bd16c,e4efec5b8ebeffc0c,027bca0a61e8b68ac,03001ea2b7ab7dc7c,548e80ab605702c4c,8f7f19b19b3effb5c,9911cda236158dc9c,a78fbc863d4a854bc,d2f45e4aa541b3bec,d79c72c767b9bbc8c,f4c2a8e24a9d52efc,f66eb7e5e670a073c,2420cd7fc7e2a589c,79ae282ad96d1421c,83d7aa7d066b6cb7c,10120632257694acc,284985b853783bf1c,9bccd3ed007b49b6c,a83fc738662c5e74c,698a60194cd8551fc,a29c13a9ae36b9afc,16db83f82ee13f23c,34ff5e998931ec64c,832c6b4616979368c,ca18c1979b967122c,fa6a8f609c01e5d2c,6464691403237a6fc,798375795bc3ac52c,b9820e45ee567bdfc,d593566fa9ca37fcc,dfdabddccf90d7e1c,e3563288635502c2c,075db33d8491eb57c,0a89ba6edb4bfe18c,17ad60db31bece43c,234e0c3320661079c,36cf954830f494ebc,4408fc1d863f0ef8c,8dacf0dd3d2b8f43c,95873c29885a8452c,ab262d923bf9bf02c,c60f5cbd80d84e0fc,cf99ced3f239cad1c,d86a0bdf3c2b1421c,e0ae3663bcb5c636c,5de479c8625b27a6c,737d9de42d34ff63c,79270eee9a916f2dc,7f24b56f9207dc15c,8325335dd0900eedc,8c9db3865e3ee1acc,d60d8010ee26ce54c,d8bf9f101d1b512bc,f25d64e664cb522dc,0128e8a766e84ccbc,0b334c2f2cad0375c,266175e63c78d46cc,55e7fbd11e88628ac,a25ca8475276f7d7c,c31882de752a14ebc,cf15d2908cfdec7fc,e2024d3671a2174ec,2bed1a43c5ab255dc,705b093ad5593e1fc,75c778365e6cf2dfc,9ff59bc45dc865e2c,c21783156287229cc,df3d8a91866bd46cc,2847e827ff5898f2c,3a7db69b7bf5c71dc,59e6b1f2f20a5246c,5c169c832deb0d51c,7d66d3294c2079a3c,9659b4159b45560cc,a71ea4d3379e43bdc,b02c36150100bb08c,be78c32025173156c,c5d9407f1e4037d3c,d83a0ed23b9b8958c,5348881bf8a15387c,73219e6fcd0d8b5cc,7a8575210da3333cc"
}
TOTAL_DOCS, TOTAL_CHUNKS = 1000, 34632
W = pathlib.Path('/content/nter-law-next100')
REPO = W / 'niyantran'
NODE = W / 'node24' / 'package' / 'bin' / 'node'


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def run(cmd, env=None):
    r = subprocess.run([str(c) for c in cmd], cwd=REPO, capture_output=True, text=True, env=env)
    if r.returncode:
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit(f'step failed: exit {r.returncode}')
    return r.stdout


def setup():
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    assert sha(STAGE + '/summary.json') == SUMMARY_SHA, 'summary.json changed'
    W.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        subprocess.run(['git', 'init', '-q', str(REPO)], check=True)
        subprocess.run(['git', '-C', str(REPO), 'remote', 'add', 'origin', 'https://github.com/ddllabs/niyantran'], check=True)
    subprocess.run(['git', '-C', str(REPO), 'fetch', '--depth', '1', '-q', 'origin', REPO_SHA], check=True)
    subprocess.run(['git', '-C', str(REPO), 'checkout', '-q', '-f', 'FETCH_HEAD'], check=True)
    assert subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip() == REPO_SHA
    if not NODE.exists():
        (W / 'node24').mkdir(exist_ok=True)
        tgz = W / 'node24' / 'node.tgz'
        urllib.request.urlretrieve(NODE_TGZ, tgz)
        assert sha(tgz) == NODE_SHA, 'node tarball hash mismatch'
        with tarfile.open(tgz) as t:
            t.extractall(W / 'node24')
        os.chmod(NODE, 0o755)


def plan():
    """Cross-check the embedded selection against the pinned screens: every key ready, chunked, in its member."""
    S = json.load(open(STAGE + '/summary.json'))
    screens, cand = {}, {}
    for s in S['screens']:
        name = s['member']['name'].rsplit('/', 1)[-1].split('.')[0]
        assert sha(s['dir'] + '/screen.json') == s['screen_sha256'], f'screen changed: {name}'
        assert sha(s['dir'] + '/candidates.jsonl') == s['candidates_jsonl_sha256'], f'candidates changed: {name}'
        screens[name] = s
        for c in s['candidates']:
            if c['disposition'] == 'ready_for_review':
                cand[c['source_key']] = (name, c)
    P, seen = {}, set()
    for t, v in TRANCHES.items():
        rows = []
        for item in KEYS[t].split(','):
            k, act = KP + item[:16], {'c': 'create-listing', 'l': 'link-existing'}[item[16]]
            assert k not in seen, f'duplicate key {k}'
            seen.add(k)
            name, c = cand[k]
            assert name in v['members'], f'{k} not in tranche members'
            e = c.get('est') or {}
            assert e.get('status') == 'chunked' and e['chunks'] <= 256 and e['content_chars'] <= 300000
            rows.append({'k': k, 'member': name, 'action': act, 'chunks': e['chunks'], 'cost': e['cost_ceiling_usd']})
        assert len(rows) == v['docs'] and sum(r['chunks'] for r in rows) == v['chunks'], f'{t} totals differ'
        assert sum(r['action'] == 'create-listing' for r in rows) == v['create']
        P[t] = rows
    assert len(seen) == TOTAL_DOCS and sum(v['chunks'] for v in TRANCHES.values()) == TOTAL_CHUNKS
    return screens, P


def max_cost(t):
    return math.ceil(TRANCHES[t]['cost_ceiling'] * 100 + 1e-9) / 100


def corpus_args(screens, t):
    a = []
    for m in TRANCHES[t]['members']:
        a += ['--corpus', screens[m]['dir'] + '/candidates.jsonl']
    return a


def finalize(screens, P, t):
    d = pathlib.Path(OUT) / t
    man = d / 'decisions.jsonl'
    if man.exists():
        return man
    d.mkdir(parents=True, exist_ok=True)
    parts = []
    for m in TRANCHES[t]['members']:
        keys = [r['k'] for r in P[t] if r['member'] == m]
        if not keys:
            continue
        o = d / f'decisions-{m}.jsonl'
        run([sys.executable, '-I', 'scripts/law-cohort-screen.py', 'finalize', '--screen', screens[m]['dir'] + '/screen.json',
             '--output', o, '--decision-id', f"{DECISION}-{t.lower()}-p{m[-5:]}", '--approved-by', APPROVER, '--keys', *keys])
        parts.append(o.read_bytes())
    body = b''.join(parts)
    rows = [json.loads(l) for l in body.decode().splitlines()]
    assert len(rows) == TRANCHES[t]['docs'] and len({r['source_key'] for r in rows}) == len(rows)
    assert len({r['review']['decision_id'] for r in rows}) == len(rows)
    with open(man, 'xb') as fh:
        fh.write(body)
    os.chmod(man, 0o600)
    return man


def importer(screens, t, report, *extra):
    if os.path.exists(report):
        raise SystemExit(f'{report} exists; reports are never overwritten')
    r = subprocess.run([str(NODE), '--experimental-strip-types', 'scripts/corpus-text-import.mjs', *corpus_args(screens, t),
                        '--decisions', f'{OUT}/{t}/decisions.jsonl', '--report', report, '--target', TARGET, *extra],
                       cwd=REPO, capture_output=True, text=True, env=os.environ)
    rows = [json.loads(l) for l in open(report)] if os.path.exists(report) else []
    if r.returncode not in (0, 2):
        print('importer exit', r.returncode, r.stdout[-800:], r.stderr[-800:])
    return r.returncode, rows


def prepare():
    setup()
    screens, P = plan()
    out = {}
    for t in TRANCHES:
        man = finalize(screens, P, t)
        rpt = f'{OUT}/{t}/dry-run.jsonl'
        if os.path.exists(rpt):
            rows = [json.loads(l) for l in open(rpt)]; code = 'existing'
        else:
            code, rows = importer(screens, t, rpt)
        s = rows[-1] if rows else {}
        ok = (s.get('ready') == TRANCHES[t]['docs'] and s.get('held') == 0 and s.get('chunks') == TRANCHES[t]['chunks']
              and s.get('estimated_cost_ceiling_usd', 9) <= max_cost(t))
        out[t] = {'manifest_sha256': sha(man), 'dry_run_exit': code, 'ready': s.get('ready'), 'held': s.get('held'),
                  'chunks': s.get('chunks'), 'cost_ceiling_usd': s.get('estimated_cost_ceiling_usd'), 'max_cost': max_cost(t), 'ok': ok}
    st = {'tranches': out, 'all_ok': all(v['ok'] for v in out.values()),
          'docs': sum(v['ready'] or 0 for v in out.values()), 'chunks': sum(v['chunks'] or 0 for v in out.values()),
          'cost_ceiling_usd': round(sum(v['cost_ceiling_usd'] or 0 for v in out.values()), 6)}
    pathlib.Path(OUT + '/prepare-status.json').write_text(json.dumps(st, indent=1))
    print(json.dumps(st, indent=1))
    return st


def creds():
    if not os.environ.get('NTER_INGEST_ACCESS_TOKEN'):
        os.environ['NTER_INGEST_ACCESS_TOKEN'] = getpass.getpass('NTER admin access token (short-lived): ').strip()
    if not os.environ.get('SUPABASE_PUBLISHABLE_KEY'):
        os.environ['SUPABASE_PUBLISHABLE_KEY'] = getpass.getpass('Supabase publishable key: ').strip()
    for k in ('NTER_INGEST_ACCESS_TOKEN', 'SUPABASE_PUBLISHABLE_KEY'):
        v = os.environ[k]
        assert v and not v.startswith('sb_secret_') and 'service_role' not in v, f'{k}: never use a secret/service key'


def forget_creds():
    for k in ('NTER_INGEST_ACCESS_TOKEN', 'SUPABASE_PUBLISHABLE_KEY'):
        os.environ.pop(k, None)
    print('credentials removed from this process')


def token_minutes_left():
    try:
        p = os.environ['NTER_INGEST_ACCESS_TOKEN'].split('.')[1]
        exp = json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))['exp']
        return round((exp - time.time()) / 60, 1)
    except Exception:
        return None


def live(t, need_minutes=40):
    """Read-only reconcile for tranche t; submit only if it matches the reviewed plan exactly."""
    setup(); creds()
    left = token_minutes_left()
    if left is None or left < need_minutes:
        forget_creds()
        raise SystemExit(f'token has {left} minutes left; paste a fresh one (need {need_minutes})')
    screens, P = plan()
    prep = json.load(open(OUT + '/prepare-status.json'))['tranches'][t]
    assert prep['ok'] and sha(f'{OUT}/{t}/decisions.jsonl') == prep['manifest_sha256'], 'prepare not ok or manifest changed'
    n = 1
    while os.path.exists(f'{OUT}/{t}/reconcile-{n}.jsonl'):
        n += 1
    code, rows = importer(screens, t, f'{OUT}/{t}/reconcile-{n}.jsonl', '--reconcile')
    src = {x['source_key']: x for x in rows if x.get('source_key')}
    mism = []
    for r in P[t]:
        x = src.get(r['k']) or {}
        m = x.get('mapping') or {}
        if not (x.get('status') == 'ready' and m.get('status') == 'ready' and m.get('action') == r['action']
                and not m.get('document_id') and len(m.get('fingerprint') or '') == 64):
            mism.append([r['k'][-16:], r['action'], x.get('status'), m.get('status'), m.get('action'), m.get('reasons')])
    s = rows[-1] if rows else {}
    ok = (code == 0 and not mism and s.get('ready') == TRANCHES[t]['docs'] and s.get('held') == 0
          and s.get('chunks') == TRANCHES[t]['chunks'] and s.get('estimated_cost_ceiling_usd', 9) <= max_cost(t))
    rec = {'tranche': t, 'reconcile_exit': code, 'reconcile_sha256': sha(f'{OUT}/{t}/reconcile-{n}.jsonl') if rows else None,
           'summary': s, 'actions': dict(Counter(((src.get(r['k']) or {}).get('mapping') or {}).get('action') for r in P[t])),
           'mismatches': mism[:50], 'mismatch_count': len(mism), 'ok_to_submit': ok, 'token_minutes_left': token_minutes_left()}
    pathlib.Path(f'{OUT}/{t}/reconcile-{n}-status.json').write_text(json.dumps(rec, indent=1, default=str))
    print(json.dumps({k: v for k, v in rec.items() if k != 'summary'}, indent=1, default=str)[:2500])
    if not ok:
        print('NOT SUBMITTING: live reconciliation differs from the reviewed plan')
        return rec
    n = 1
    while os.path.exists(f'{OUT}/{t}/submit-{n}.jsonl'):
        n += 1
    code, rows = importer(screens, t, f'{OUT}/{t}/submit-{n}.jsonl', '--submit', '--approval', prep['manifest_sha256'],
                          '--max-chunks', str(TRANCHES[t]['chunks']), '--max-estimated-cost-usd', str(max_cost(t)))
    srcs = [x for x in rows if x.get('source_key')]
    res = {'tranche': t, 'submit_exit': code, 'report_sha256': sha(f'{OUT}/{t}/submit-{n}.jsonl') if rows else None,
           'summary': rows[-1] if rows else None, 'statuses': dict(Counter(x.get('status') for x in srcs)),
           'publication': dict(Counter((x.get('publication') or {}).get('status') for x in srcs)),
           'not_registered': [[x['source_key'][-16:], x.get('status'), x.get('reason')] for x in srcs
                              if x.get('status') not in ('registered', 'already_registered')][:50]}
    pathlib.Path(f'{OUT}/{t}/submit-{n}-status.json').write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res, indent=1, default=str)[:2500])
    return res


def minutes_needed(t):
    # measured on the previous batch: about 2.7 s/doc to reconcile, 2.3 s/doc to register, plus a few minutes of offline preparation
    return round(TRANCHES[t]['docs'] * 5.2 / 60 + 6)


def live_many(ts):
    """Run tranches in order on one token; stops cleanly (credentials removed) when the token cannot cover the next tranche."""
    out = {}
    for t in ts:
        n = 1
        if any(os.path.exists(f'{OUT}/{t}/submit-{i}.jsonl') for i in range(1, 9)):
            print(t, 'already submitted; skipping'); continue
        try:
            out[t] = live(t, need_minutes=minutes_needed(t))
        except SystemExit as e:
            print('stopped before', t, ':', e); break
        s = (out[t] or {}).get('summary') or {}
        if not (out[t].get('submit_exit') in (0, 2) and s.get('submitted') == TRANCHES[t]['docs']):
            print('stopping: tranche', t, 'did not submit cleanly'); break
    forget_creds()
    return out


def rerun_previous_t4():
    """Duplicate-safe rerun of next-1000 tranche T4 (188 documents, already registered): expects 0 submitted, 188 already registered."""
    U = 'https://raw.githubusercontent.com/ddllabs/niyantran/e3f9841072dbeb8f3435bfb9aebdd50543ed2e62/docs/operations/law-next-1000-prep/nter-law-next1000-live.py'
    b = urllib.request.urlopen(U).read()
    assert hashlib.sha256(b).hexdigest() == '7af1a8862b63a7a593691d6d2e6bc90a505753230dd40d23ab28e6a633267184'
    g = {'__name__': 'nter_next1000_live'}
    exec(compile(b, 'nter-law-next1000-live.py', 'exec'), g)
    g['setup'](); creds()
    screens, P = g['plan']()
    prep = json.load(open(g['OUT'] + '/prepare-status.json'))['tranches']['T4']
    n = 1
    while os.path.exists(f"{g['OUT']}/T4/rerun-{n}.jsonl"):
        n += 1
    code, rows = g['importer'](screens, 'T4', f"{g['OUT']}/T4/rerun-{n}.jsonl", '--submit', '--approval', prep['manifest_sha256'],
                               '--max-chunks', '9484', '--max-estimated-cost-usd', '0.51')
    s = rows[-1] if rows else {}
    res = {'rerun_exit': code, 'report_sha256': sha(f"{g['OUT']}/T4/rerun-{n}.jsonl") if rows else None, 'summary': s,
           'ok': s.get('submitted') == 0 and s.get('already_registered') == 188 and s.get('uncertain') == 0}
    pathlib.Path(f"{g['OUT']}/T4/rerun-{n}-status.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res, indent=1, default=str)[:1500])
    return res
