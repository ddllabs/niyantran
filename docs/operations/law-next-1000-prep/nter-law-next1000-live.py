# NTER Law next-1000 LIVE steps for decision owner-authorized-20261024-law-next-1000 (approver Vighnesh Shukla,
# relayed in chat by Tamanesh Kauri, 2026-10-24 14:16 IST). Exactly 1,000 IBBI_NCLT documents in four tranches.
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
STAGE = LEGAL + '/staging/staging-next1000-20261024-0853'
OUT = STAGE + '/authorized-20261024'
SUMMARY_SHA = 'b48c00b3fdf153cab22e03d9cc00708444dcc2a27d8688b30070c435fa76b8c6'
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
DECISION = 'owner-authorized-20261024-law-next-1000'
APPROVER = 'Vighnesh Shukla (relayed in chat by Tamanesh Kauri, 2026-10-24 14:16 IST)'
KP = 'law:trib:IBBI_NCLT:ibbi_nclt-'
TRANCHES = {
 "T1": {
  "members": [
   "00001",
   "00002"
  ],
  "docs": 289,
  "chunks": 10480,
  "create": 289,
  "link": 0,
  "cost_ceiling": 0.555756
 },
 "T2": {
  "members": [
   "00003",
   "00004"
  ],
  "docs": 312,
  "chunks": 13788,
  "create": 312,
  "link": 0,
  "cost_ceiling": 0.732443
 },
 "T3": {
  "members": [
   "00005",
   "00006",
   "00008"
  ],
  "docs": 211,
  "chunks": 10784,
  "create": 165,
  "link": 46,
  "cost_ceiling": 0.57331
 },
 "T4": {
  "members": [
   "00007"
  ],
  "docs": 188,
  "chunks": 9484,
  "create": 171,
  "link": 17,
  "cost_ceiling": 0.502106
 }
}
KEYS = {
 "T1": "1c41876c6cd9a4c4c,101a88ee79005b89c,621a3e22c0a37255c,a2d028abbef2f615c,1faf5a0fb991e0eac,4edfba4887de6a59c,6c831f5a24f771bfc,70f9e676759f211fc,869d8ab96cafb2a8c,cd32f2e24caaa480c,3dae93d58b692b49c,417590572191f39ac,48c20578a0f599fcc,968d5ae672c00f17c,b4bc84e4291894b2c,f3947f75cb712d28c,042b27e6f51409c4c,31876d254b2faa2fc,754611bfabe90686c,a1d63a1feaa7109ac,b816a6a679fa111dc,d8573057162e95ffc,08ab6d008c6fe04fc,250ead608b26482ac,38acf04cd121f98ec,38c92a036cd9ecd1c,4224c70ea42306b3c,665c92a433e76cadc,666e9bca167b2dcbc,6d228c7e15d6df71c,6ef2d3a28077fcf3c,7490a5f56a0ab07fc,76e66828c153a275c,86ad9cc2e33d5fdbc,8d5cc221900081ecc,97f9d8a9b7e65c34c,9edcfc7c95dcdfa3c,a2d0bd94d87738dec,c5e687483806ad49c,ddd57033faa4cdeec,ef8e3072d79c4af0c,0475d098843c231cc,059b80c6f2d99d7cc,09d4e9f977fdd1e4c,14a3dc77acc1c41cc,441c0064f518ae3fc,505feaa3ff495004c,5708991381f33f39c,90a131d3ae181f61c,9229db3e84cb3688c,bfec4447fbdfff48c,cbbba0eb5d0a75ebc,cf5cce4c34224c83c,e5fb8b43002e1674c,9d84ba0cc6eee5b8c,c133f823534a2d26c,209c1c42c59ab4dfc,ca9f08673f5a6273c,8f2b92c9c1fcfadec,976212c3ac31adc1c,dfcd6810c6bc4827c,fe29670aec537886c,184cbefdf74edcc0c,2d94a7c70344b8f1c,37caf5f2a3c3b3b7c,4e40a6d280eedb9cc,b48b3528bf02df2ec,edcd61a87fda061fc,1fb29e856f16b6b8c,d5ba1c72b5884305c,dfb35b2851846e98c,2de47e506c5be562c,662fb85d42614b10c,78fcb185729cf194c,7c39cd109641d2bfc,9b25c830be36b105c,cefdc0407d1ef281c,063355ffb4caa301c,21549fa1148b681bc,383fa93910c0861ac,5341b7aec73d14f7c,6e1850ad332a6acdc,07fc5fe5aed8a545c,0f020079feebf890c,410f5f1d7d2f4c23c,453b00f44bc474e7c,5d310fde84ff26dec,6039ae60949ff533c,75e27aef8146f06ec,ac17a712efd51f51c,b2fa2c7a979c024ac,b7357a518564b552c,d634d12cfb4bf46bc,f0f1046424c94285c,015752c0a9b9749ac,22c6f0ef5a91bebbc,3315e05a6f6a23a3c,6d9003ee9cbf9e79c,7ea254350c674965c,207c198aa720d472c,cf16ac1d9e1b768dc,4b4ed5be93b305b1c,90745e38f360aa80c,c4b0bfdbbfd69422c,03ab74c424b5b7e1c,2bd2011728ee981fc,62a837afd7f7eca0c,83d34d227bfb8bc7c,032e5ac7a4b14533c,2dfcd79940d2047dc,3ed674a74d7b4301c,859629c139751331c,d2a9a76171818d58c,f7b91aaefe969d54c,f7dca6c5609ed982c,f87d079b637e03c9c,c203600406e96da6c,f0d91e3d0925c65fc,43aeffdcf47ac251c,b2a7c862154456ecc,b9d51f466d97e3c2c,f07b1c2f487903ddc,1a8effa4ad7f4aaec,500211ee343f1c3ac,5a756723527ee873c,7c59c1177bdd6330c,935f95191899fb0bc,9b8d96b2e4e90d1cc,c40bc0e2716f4509c,3db2e480e6c2b47fc,6c7358a600866bfdc,8360bc2319a47bb8c,853fe80ce40164bcc,9a8ebc289766e877c,ccd7f62c559a6ef4c,33625eaacb0cba9ac,5486a45d7f9094f4c,eeb14814eb2e9120c,6d6ed911d5b31363c,7b03dea6c2937a17c,7f86bc650ebbe840c,9c3955d7196f6fd8c,fd1e3ca2dec05e08c,ffc40e529664b275c,1fbcce42ce88b19cc,2e31fa6ad1bf114fc,4ac5640283ad9545c,b7d959026b89070cc,6663ca4d2c985597c,9e201c9117359028c,c14bbf96218d743bc,c4ca2c62588d6541c,cafc6e02f1ca8ef0c,f8d9978b972fa267c,09bd86bcf95ae4e3c,8b0d69c0b6d7b056c,ec9fedf394c6f796c,1f18b167a45cd40ac,25036618942b575dc,45bb3a5cc57e650bc,4f44cbb29ea61eecc,60740924671c274bc,7a2dabde5205daf6c,b159be54b3848577c,d96588eadf93cab2c,8bb91b72100cccd3c,94652c205b1f236fc,dc0ddb1b2f5c15fac,032c839b2ea1b9d8c,3c080dc2b96a0965c,4f834273c98c156ec,68ed5ba9ae56a7acc,69b5be371d211708c,7bbad4323bfad266c,7d9dd546bdaae926c,80b5c89dc3b71619c,87e5209400e0f3e2c,e7aebea7331a6ef6c,3ca0f64e7a525f8ac,97eead4423ef3192c,9a4566b6863c18f4c,a7d9f8e73e48fc75c,bcbdd8752a91acefc,fdad4b43b0446c66c,34f8f32e3b75c1dbc,6fc693f945f52859c,b9f50ff69f10c1b8c,6ded051ea96b4297c,d1c395ada6754795c,e3b7f9052112d673c,fa8ee4da25383a64c,242c58bb1ead973bc,45f439498ff31e00c,648cdf730cefb3d8c,3c90842fc4632116c,6961cd5268ecff49c,6f1992f268be0704c,72562d6be66b1081c,76ffcd414070cbd8c,addd690eefc36fe2c,d2caa116b6a34821c,d7030f405517b15cc,f117aa46ccb81604c,79c152477cd468bdc,9787fc7a9fb90befc,9ef1d14a2d1086fcc,bebb4de60e94a4f4c,d37156ffca2055e9c,d952c725c5264980c,dd467ad5dc3a478ac,fd45cad0fcca13d9c,20fa0f9f06118450c,2255a43355aefa4ec,94b3749b488ef2bfc,9dc3124ef7965e7fc,b9748f02ca66125cc,075fe399cefdf045c,6df51235273033f3c,7a0ed44b1f5b56d3c,85576d34fca280d6c,b14db11fec9c0d07c,c1583b36ead6f5f0c,8e2a2c17eae93a0cc,9f9414a07a312f93c,aad95dc2acf976dcc,abf8cb443be9584cc,bfaf601d01314526c,cecea21d595c3204c,139d36f4edd91206c,5bf890b0d3d95172c,9b46e9187070fb04c,c192a668525b120cc,d0e2c76fec26f418c,068353104300aa5cc,0a5795d1af1f52c0c,0f8b5130b63d25c9c,1ec46967d0af14d6c,378b7fbbb74a3bfdc,383d9b5abe4c111cc,4006d02a4da37e2bc,493d8fe0f3523a4bc,53ba102e32d209b6c,60cc8ab156d56e7ac,72def1468fcfa5e0c,88c3f2e7a07e673ec,96d1ee32283f2f0dc,991a5036b05cca3fc,9bd40b22b6ff1fb6c,a3651e1f4f06bd71c,ad108bb70c48a393c,b4489066bdda1bd7c,d03c2822e12b0174c,faab9a20a081ba97c,ff90832bed908415c,080f6894a26eac55c,0878d2a5424be760c,094c920429cca778c,8970e279f5e22a8dc,e7f861d4c269c7a9c,2687d793ba613c49c,ed2a6d499948264ec,942cdadd8b5adaacc,b5a8127788f16af6c,1ee95f19ad7f7098c,c0003b97722c65bbc,fadbc25b424578b6c,45cce446f24bb8d6c,61e7803da906a7e0c,96b330e0bd9acfefc,af1a12e973a6d288c,c768db6071690dadc,0a0f7ea26079bcadc,3e86afaf2cdb5f8ac,606d781cbb9e4cc2c,a334b37c47f00089c,ebd0f79f314096c8c,36cada126e0c9d7dc,5cbe33a310dbc833c,6b68e190161c40eac,6bf8d3c1e369c7c3c,8e411876e9d95ff4c,ec18f8a724552004c,a0bafbf930755ca5c,b82da260a9036e21c,f88d6f3eff72a31ec,010a2d6a91e65798c,120f8bec83a722c4c,3983448339e8add1c,ab3bde5f3b514fadc",
 "T2": "ae022d5fb3da4dffc,d9ed9eb0c4f15412c,099904b91591e49cc,16ca8c5ee67bba9fc,333e241fe6fbb943c,3cbc6b938cad4edfc,78e19a5f821daa1dc,9e5a1e09b1583550c,a84283c2e6c8d8aac,c16b99f9224887bac,d17af34541500665c,ee69a0ff12a753a1c,05164caff89ab1bec,0ba43a5d35d9b638c,0cc6d5d3e763af1fc,69ee1df5d5745bdcc,6f63bf30cdb26a96c,732ef9d1842cc75bc,8b66723b8f7ee2a3c,9496bff49fb3c2d1c,9ed8f69d6c05bf3ec,e4bc17fdb1ff9861c,eb52470f7a20803ac,fb64bf00d9829a1cc,014a6594c7382c62c,1360d4b7f3c4e951c,289f4fb24632c677c,80a9e4fea46ee6c2c,8792d29864e700c2c,ab70754dd381260ac,d6d6c09a44467fe9c,fad04a12ef070e55c,2baa32685a28db9ec,521cbe2b58a6c2b3c,61e5718fb843d500c,81bd93182f3efb15c,928bfe33cb9c5603c,a28e7a1a21a1a1fac,aedb1bc15741920ac,bc3bc52feb79f29fc,d417228a3b9b5b29c,e3cea6d119845313c,fd3c6ce3dcae8ceac,29ad96c045065392c,2fa38758b14c6e0cc,3d63bbecceed3a52c,4b27ab586d275c74c,961975333bd601fec,c110eb45bba00f70c,14fd5f87983ac13ac,1f694ac511754b4ec,7511284564a881f2c,7b8d9e7cf5d6fa74c,9fdce115b1f0834ec,b2238c5ead1b4fe2c,b26453503349e8b0c,0251f46b7a54b9fbc,272d483a2c1b044bc,40579188aca215a0c,ba16b7cc2ec0b79ec,f28717fa53368d71c,6abd906642573048c,c71b855e0b2e1b30c,e6ab92d8e03ca745c,ff5cb0742f9a3834c,1c4bc8c4608194b0c,32501c3184dd8f40c,55f8fd382658eadcc,70ab08743b8c04e1c,85176f30c9f03ea6c,8687445829574101c,94a44372cdf6f7e4c,a4a70d660dc38254c,ba4f36ca7b581693c,cfff99dae46bbc0ac,ec81c726fa8b9b37c,19099491f77aeef3c,5e614d8fe3d1f2c3c,656721f25d9d6f15c,668c96b81edd3d05c,6bdcf15cb06d7715c,929ec14b4e724110c,c00df7c8f24b89c9c,c59b4484e3246ca5c,c6bd3ebd7077cc63c,cdce06b9720cc57ec,d0bee19c5b557497c,320c3c9ba06e4013c,3ccd3a6d4346fec5c,5c305f1ea4bb34dcc,8dc283698ec420f1c,b50b9e9aacb62e81c,ebb419e00f3c79c6c,0aee4523c7d8898ec,6b56be2bb3db7a48c,725596f7ed117d4fc,7995e51e9f2b6cbac,b8988484c77b8b83c,bf9556a3476cb20bc,d657e44e2c74606cc,dab843c46e4c6f4fc,dca43e31cc708568c,fc2635dd896713e0c,167744200ac25c66c,1c1e518eded33e3ac,2b9f8be2f4cb10b9c,3c4ab79f989cc314c,5ef70f440df213aec,7152c7489c7f6a07c,b499c7de66160061c,c8ebc80fe8e20fc2c,d1e562ca4ec1f4fac,df065c804e2700f5c,eadc5a08a8feb991c,f800e28e2cc6ca5ec,30183c0c3962f3c2c,46ec223eeb92d231c,e2ae2cbf4f2ed860c,26666279be258502c,3d39f13a161a67b9c,bd62d634e033bc13c,364ac6a5ba8213d1c,1a56fa07ded45043c,20baa5b4715221ccc,23c3573475850123c,53c54f3b6c0d3da5c,6833cf0caaf2dd1dc,8512ac5bab012e86c,9f9ac11c110005b7c,e1428d4bef73c200c,f2a0d7b39598d77bc,456fc05f0ef2718ec,4a3b29094d95a3bbc,66351375047adf22c,7c2238be0946e5dcc,c1a0913ce8213428c,c78ceff816462dd1c,d35dc93758d518d9c,e0026260406e2aa6c,34711b5890ca8db0c,51575008e9926201c,a840d8ea6bc5a013c,1f8b751d338479dac,1fa8a7376c19d6f6c,4e3a05471fb80244c,c221caeacc790479c,20b65a04d1a9df88c,3cfee2b225a4b61dc,5798f31f64eade5cc,5d31a10be6041756c,69d5b157a9c1feefc,98da2e12128c15c0c,9af5d008264d3cf3c,a752dfb509c83be7c,ab3df155a5566bf1c,aced2b43cb71f1a6c,b0b441a2376bf386c,beb434e96ff3bf47c,dcb18dbbdd7c2d7cc,dcb22700154f5e64c,ec4bbbb4dde5b05dc,103698ba2c4f0c9ec,1fa05aab9012f9ecc,6bd01a14132d65e9c,705ea076b33a085fc,9cf6669a0669e676c,aa72fa836bff2b42c,ab467c68f9659b04c,c00fc4601e5beb21c,d9abc99d45d93f65c,fd147614548c14cbc,07382398ef8eab48c,0f1ab982d5f659fac,3d5c9813c6f6f6eec,4c39a9f8e6b0348dc,5ed69d776781fc1ec,8a9944ae4c12689ac,940fc02570b07781c,0a1e57533e6b3e1dc,0ee3010c1f3043aec,500953812ff719bdc,6ee892b963deebeac,85d00ffd5fb45dd5c,9b4c14bd01ec60d7c,a00e86b5215deef4c,ae25e59c1c834e35c,c06a1a100bcb3042c,ec167112f6d83053c,ef5896a67329b95fc,f2427a08c8b7e9c7c,21e9ad6f05711ccdc,5179513b5cc02f33c,538dd432ff514f92c,689176ea9407fdedc,93cd497eb086ce7fc,983e2a3aed4a2c26c,b3bc614cea4b3a15c,b4f87e11f2513e0ec,cbafbca59332cbbcc,ec2ce77826b6b313c,122d10ee85f84d88c,1d734b4f96e9e285c,29c1471d00edeb6ec,97ea52f07eeeae59c,d8d5797b1eb04fdbc,e4f2f2c976b0c7bac,f873ac11325859ccc,fb9ff422535b907fc,54b38536253bfbc0c,6805984832488ec6c,923199447683a97ac,fc0f0cff63e3868ec,06c2d47f02383e76c,3ed86a2932b81ef1c,516f7b5fd2cb5e63c,6b0f09347563c919c,94dc0aca442a2f39c,dabc56c517cf1fdcc,e1c531dc790775cdc,1c6ecf67e3474429c,22ef635f83e9580dc,2985c1e530a7768ac,3cdaa200b60d6729c,4aa1e421765fc151c,70ec9df202e9910dc,8db3f3b5d8791159c,94c100f56b69154bc,cb272d6a9322a6aec,092aac9924cc78a5c,25939004e9b074dec,26bc445f09348c9ec,2d32a0b259290912c,cd4d6f98f8822f6ec,d46da96f61dd94e4c,060ef02ac38da651c,330d82a720880f7dc,db9d630fda034adac,7aea76c1f2d12de9c,7d3514bb96a05b5bc,246b4e5eaad0239bc,2c1c109a08bef915c,3dbb6f2057ff700dc,51d7e2b50d9c0246c,6a6e357b7da523cdc,7e08241f66f1b9bac,98ea2f346191a838c,b82a81001ca7161ac,2ec11f7be6538603c,49ce7a125495181dc,528634d21dbe7524c,5df7b6d9715a741cc,644009ba9d1d3646c,6c91b0bdb0b243a5c,819c98c9a343ff21c,c2c5c4f395f48746c,cb761d7bd685e6f0c,e4b82156cedee806c,31ddc0706dcfd234c,42beb008959ab754c,554d5c4ce5be8fadc,8be6bfed6f35b860c,fe559d155594f44fc,a635f7ceda2f79bec,3d1ba22086fc4270c,ec333e1e468b5432c,33ebeff734917ddbc,e1cb9a3a861e6b0cc,e20f018479f4dc2bc,099cbb21cc973672c,0ab0417aa9141099c,12bca6e6757c9682c,23c56132cf87aa9dc,4ab7e4f1519cd711c,63a01315c1c799ecc,63e023214c80db23c,6544c0689ac1228fc,6a4e34d52f90ed62c,6cec0431c5ce0b86c,ac2f08274420edb6c,be9ed679d37ba23fc,dc5fb058f281689ec,dd3daf1575dff05dc,eca1cb77b20bd438c,f14cd5c302daa6f0c,fc0b94e14756ee53c,4fed2d472ad4d043c,71b8bd7591f7ce15c,83c189650d5c1d10c,98ee392e19eeb3e8c,e135e82dbe0c4061c,ec9787c3b841cfbdc,fdbf8794295af7ddc,6217a646d5c8fbc0c,6b0acd91f35a59d7c,77bfb1cb9d91e5aac,8867c75b77b29b26c,8ce3a42ec1a8f10fc,a730f5399bc03ce3c,b5c69e5044ef0792c,ca038d2222495658c,d7ec882003401eaac,04d2e9c1def344dec,1572734c7bfe3fa2c,2b8e100c475632e5c,418a4c90c6dd1f85c,601a20983ee704e7c,6e5e121338633d04c,7f576d9830187343c,a5acda609edf9218c,ff971f7d8779e230c,266f39c293946a45c,6dc6873600726a09c",
 "T3": "a28d072ef4027c01c,afa7d1882c14b355c,b3e8568c80ae4988c,e3887402eba3d2fec,ef44340d428480d2c,f694d0125db36e04c,0137047ab1b2345ec,2bf85091f58a7e67c,374b54ff0fd5e85ac,5dd0b7c9691ec451c,c67c3492ae55c5b2c,cb079fc04a307faec,db2343c77402153fc,e4b2ce06aaa073b8c,f7885c5df4f152f0c,fcd8d6e6a1a4548ac,302cfb301130337ec,846347c40497534cc,88eae581d3b588b7c,c459142689dd1f34c,d6e5996b591575c8c,f25f0aa8e7f19ce3c,13d4ae9007204331c,1a65ec42956688b7c,1fc543d48ded2598c,4fc52129f6792c0dc,56d8c698a00bc182c,6f8591dd8f87c883c,98af0d215f54279bc,e6e2e7ff39030073c,f88a3d83baa47e42c,0ff1c7e0ffe0b104c,266bc16866ecf0b0c,39e39f7f17a68d21c,3a96ceb5d7c45e44c,43da8ed5ed7ca68ec,4d2815b3dd21a57ec,53c66194af6cd7b3c,6812b387193568efc,685126bb2b710c42c,94f64a2e65dff6f7c,9a82d1eacf5bfb04c,9bf3658a4f5eb9a1c,a46d815d868beb33c,a8f707b20647faaec,c03702377dae46a6c,ec2a29b9192f1d24c,0357a9b86b2747b8c,30641e28416e37adc,3cff99f7e7d456f6c,452962f4ffe9fa47c,4c415059d098f6ecc,6c67fd152e444887c,6cef3c8dcbac15ccc,71cce8cabcb6a6ccc,895cf636e20ee43ac,8bce62fdb7dd66d3c,9b44585dc47d0ff5c,9d8fe950f36d47fdc,ba40ae61e50922cfc,d8919cfd8000d50fc,e4b7761ae140c8bbc,ee0527e52783585fc,f05c46d1a4e7b6b0c,f6802fce8603ef33c,fd727be4b212d7acc,0ccfa195ce272690c,1e22dd56570c3b79c,5b572e1379a6092bc,ab176714cdf5bb0bc,25c4cb819bf62135c,2e4bfdceaab23155c,a02851bc0da50283c,aa4724f16b24e62ac,d1479ab7abd79f98c,074908de34f07b03c,2e99bf16bcceb1cec,97c97046a286be90c,9e683e12425bfdbec,0edac104cf7f8ecec,1521cdddd5f42fccc,5315a3c72077648dc,948fab3698ca2b8bc,ab7a85052eba49cfc,b30b2857a34d05b5c,bbc72c1418282ee5c,06feb09650b6123cc,3a0bd5ce696143e1c,a7679d9a5d27f933c,aedcce8bc5b44530c,dc4d7756e536916ac,4d677b1ce35e694fc,7860b4ae6d3f288dc,80d01cc04b54c43cc,8c7cfbc33a982b8ac,949f67358d052308c,c0dd40465fe11721c,e698dcd900a74c92c,ebe0517f220d0526c,777dbf2e4c1704b4c,8591d8d14f1ac995c,9d7ebc346dbccfe0c,aa41b0c364cb4d92c,b47ef56ae5e87342c,14eaa929a5e05666c,0afeebc7c7236e77c,1a8de6fd38d87f7ec,44b64e4c87370edac,526e305a9d728211c,7baef6d9b9241450l,92422845788cab92c,e409c22f8042d8e6l,2ac97ca03e5e7121l,3252904590c00d72l,3e54b7bbd0a491ael,45cb4b4de4ebd5a7l,81f3b96d95766610l,8d733c3bbb5d95f3l,9dac58b67a1ffcb1l,ddff662db367bc47l,f711149df54ed992l,1f500a4f887a30f3l,ccf9e0ad99858464l,f0aed5d28e83a061c,1f0faa9203e8e2f1l,23193d0826f8d20dc,25fac0078e0475c5l,5a2a16a6581d5667l,798cf34d3a3398dcc,8cae5342549ee02dl,923c8fbf001151b3c,fab54515fc2b50a7l,28830a4141c3c624l,469c92c82058ed75l,49a6b604f1940df8l,6c709f077aa2866fl,758dc50d2f791b82l,943ef42ae32fd64dc,ad063ff00fd2d10al,da8f5e931fff3777l,72ac89b1c68f1131l,c057ed1c9e62d23fl,d31173e5ca3bebcac,d48d25752aa36e20l,db46c75549c9906cc,de472c1b59c38b92l,10c8963937d14ea4l,2c0c6e55c4a04fc4l,570ae649f9b7ebd8l,650f5e683a0b5b93l,7474f9edab8ce357c,b0bb41f3d7dd6a13c,c3db4519ee64ba16c,d41decb4d481b024l,d5e1879c93dd3004l,da439d233346f33bc,f3fb37f02007664ac,310fbd7a6d9d6f5dc,fa4e71d0cf060621c,95d171395eacbd55c,967a582e3fc9dfc7c,069354731815906dl,13fcff8e27d3f03fl,2b1ea456df48b626c,6e9437694ebcedd0l,7911aa03c4f488d3l,83ac40bc2d851081l,adaa10fa296ab626l,bec1a5d14e010667l,0c9f86642aae3304l,3e6624acad1cee3bl,ce4ca524e4942316c,2243e02326e4cbb9l,3b544567171cee73c,5df5d0a1efbc77d0l,e661d90bfa28591dc,535febaab27631cfc,c74c725d703af5abc,ce113d345927ff09c,12feda5129d9636ac,89f775b267b715ccc,4a6cf54acf09490fc,6b4f42219ef8896fc,76e736bd17cfa809c,83621158bb4f2652c,07d2927639446883c,4f1f1b3a612e8e1bc,0e27b662520fb68fc,27a44eb7e546b4f4c,6765385f3eb90894c,7a572760cd671520c,e8435490286d154cc,f86e7a2580a50a5bc,16ff9be71d6b6204c,24706f5ac9d747f6c,3d28e5da538f504ac,3d5ad572b11f09adc,466b3c2c0834e1ebc,58f98e88ae087aaec,eb99c318ed57f2f0c,06d05b052174d253c,443ccdd963c4ebd2c,4e9b4fad4b08b714c,54ee64822d6c05f7c,5c1b5c1e67bad7a2c,7b89801cb8cbfba2c,9cc07303faf5fe06c,c037ea38c637f736c,c7e5a494cc7f864cc,d1aa558cae578423c,dbfbf434b2584c57c",
 "T4": "6b7c49c2c7ce1e6bc,f1da693439d5aa92c,f3b1aa62769e0887l,12ee1c6c95134c04l,13f7a1d1197f1757l,1502c977a0ef965cl,653c1fb58d89d2d0l,88477d67957cb10ac,ba25da0efda7eb44l,c22368a6a1e7d5b2c,c32da9dc9e9fee45c,c75aa144c7de73c1c,f6f30c61ab02cebdl,7b37b145c6e0ed8fl,9505ae48f21a5dd7c,0b274d936b558de4l,82c13cb652d2a3c5l,9e836e6ca21981cfc,fc50212dc5b2b63fl,2a3fd0aa8a349ed2l,2d59889bfdd620bac,6cdd3ee4bff29412l,8f14c6a9596b29bel,9500042225856e55l,b8bc7ef6a9a6893ac,b9a0c331c2b8f47bc,e832901cf3d987e3c,0c0585b7b2d88fdac,15a159fdd5132238c,47296c4d2907712al,aee5da2c11c4ca8dl,e0869051a4d50f3dc,0154f4c02d9538eac,1efbaf0250471fa3c,2928b3b53e0abf59c,2ca0c8e1c4d876b9c,329fdf8e71cc82bac,8635206d694cdf85c,8e371753967258fdc,ca3e36e4b0e997cbc,0a8201f0ff9ca14ac,171e0ef02924b696c,60aa4a4cd50085bec,a59c92bbe28e72cac,ae33923c1bfe261ec,b4a573d6044b84d0c,bb90fc84e7af190cc,e201335db99e6bd4c,01eec0bff1e2a902c,2fc564669a90d765c,5118e08146343636c,5898398066676c6ac,602d80b29db5a7fcc,628cde9ca3e2dc8bc,6809836ff87553a7c,7560b4ec79da0be0c,807c2025256c407cc,a09d6f339392406ac,a2ce55b3a8b3660dc,aca44f42df032630c,fefda5d8137b6203c,42097de3e07ef72dc,922f3caf261775c9c,a43ae232d87184f6c,a7b18cd45638cb50c,d356cd6ef291532cc,de7f2a2f921aba9dc,42adb72f480ac28fc,4c3fab4945a3417ac,9aede2dcfc4e1c91c,a18ccd6ae9da1b62c,b3f49d5a75fcf49bc,c4f2fc5a8fe7679ec,c940a6a71b35a4adc,1676274a732ea499c,201b98eca7fa2e60c,4b8888d916b27861c,5d8fc70cd89c0f04c,a96fb8368271d06cc,cff46501358ede15c,d79e3ac1dbb8e143c,5eedce961eaeedc6c,786a0e6343473375c,16866a9ea1156aecc,1939a09cf3467f0ec,2d8a6173d9932fddc,77e4e7d97b51e91cc,88dc3ce1d029086fc,cefc1e67db60fb94c,e49bf10a9db70506c,e6fc671370ad9931c,2fbf4d55c84d836dc,379fc0a9b59e435ec,3cfe97837a3ef567c,530c52b0695e75c4c,56435304fda7516cc,5dabe4bdbccc0e31c,76a809db0ed50eb1c,7aea9b0d230739aec,9eb9dcf41ff78235c,a1ed53a417b5987fc,f18a76553843aa2bc,ff0000965b213917c,29340e104c4ca788c,3eac97d3c7997ab2c,547d025bdc014c75c,567bbe1b33698c26c,7559ba6bb4b534c2c,847f5d5c9fa7a549c,8fc5873c75e028cec,9e3468f96802000ec,ea7f367d03a59524c,eb45de49dfc4b971c,23670e29eab98c97c,348a551e7a36ef0bc,a2ca2502ceb7ff16c,52bab3773d27d1e2c,57dbe47cd719b393c,67eeef2724d34e0bc,892fcdfe4ffb915ec,c6e4249643625baec,2b12daf897c262b9c,365af418c5c789f1c,4355176aff721ec6c,759dd1118c2abb66c,91ce60108312f7cec,91f626ea2220df9ec,aa4bdbefea2cdff4c,aac116a882633948c,ad4b7019bbc23adac,c1ff33528845e773c,3f0c415d9eec86d0c,3f636df279b6271ac,b89455d4b129f097c,3f1c4b78267ebf04c,a87a7d6cfdeac47cc,0aebca225a28269fc,48b2eae519f0b450c,5a973596c83d10fdc,6a7e1f18a2043ac3c,6c05a40b2b47e569c,8acbeca8f6ac440ac,ab183e2e93b946c2c,b75477886e2fae95c,c73339e07cefd51ac,c817babb19a3b340c,ee3c632961b671a5c,295b7cb01ad9262ec,63c11b3ee17fd6c7c,7cb287a35ee1e89ac,a8902c9758ee440ec,3d0bdc79344c26c1c,5ee546c1eae6a8a0c,77274ce8e9134384c,8cf0c29f691fea2ec,ab3575cada19d89dc,b18518da782d1896c,bff9be34e22ac06ec,d73f0621907d7acfc,fca5610d28fb3222c,022b03158abe0e93c,161f0116d0cdbf5dc,299ee7fe8b84fb38c,48d1c7740f211866c,7374a12d5a0d0b5ec,b899cc2fe8e8b39ec,b98d7ae9cecff955c,c44cd9f5c63d658dc,de68addd6d0322cfc,02b92a0af5a27f10c,34709f1bd81fa083c,38160ee83aada602c,3d27e489fe7b55f9c,61ccddc3ac821e96c,99a47318fb94e2b2c,afe7f1dd88586c8fc,b5e5aef30e440a07c,b7e6b2119175a33bc,c7740804a17c0468c,434169963801d328c,4422cf26a3afc6a9c,afef6180b61bd3bbc,e6489806f5edca1cc,17b019e1a6d06914c,28a26fe248c77385c,8a27fd9be7255c4ac,0afd75ef85752709c,1c6b61cf8d454ce2c"
}
TOTAL_DOCS, TOTAL_CHUNKS = 1000, 44536
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
