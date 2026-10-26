# NTER Law batch-6 LIVE steps for decision owner-authorized-20261026-law-batch-6 (approver Vighnesh Shukla,
# relayed in chat by Tamanesh Kauri, 2026-10-26 16:29 IST). Exactly 1,000 IBBI_NCLT documents (2025 p00006-00009 and
# 2024 p00001-00002) in five tranches.
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
STAGE = LEGAL + '/staging/staging-batch6-20261026-1100'
OUT = STAGE + '/authorized-20261026'
SUMMARY_SHA = 'a9aac3351f617fb62bdc61ac650b1dbe11c4102ed0874969b0356455362c9de2'
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
DECISION = 'owner-authorized-20261026-law-batch-6'
APPROVER = 'Vighnesh Shukla (relayed in chat by Tamanesh Kauri, 2026-10-26 16:29 IST)'
KP = 'law:trib:IBBI_NCLT:ibbi_nclt-'
TRANCHES = {
 "T1": {
  "members": [
   "2025__part-00006",
   "2025__part-00007"
  ],
  "docs": 205,
  "chunks": 7339,
  "create": 205,
  "link": 0,
  "cost_ceiling": 0.389614
 },
 "T2": {
  "members": [
   "2025__part-00007",
   "2025__part-00008",
   "2025__part-00009"
  ],
  "docs": 205,
  "chunks": 8625,
  "create": 205,
  "link": 0,
  "cost_ceiling": 0.460493
 },
 "T3": {
  "members": [
   "2025__part-00009",
   "2024__part-00001"
  ],
  "docs": 205,
  "chunks": 6248,
  "create": 205,
  "link": 0,
  "cost_ceiling": 0.333223
 },
 "T4": {
  "members": [
   "2024__part-00001"
  ],
  "docs": 205,
  "chunks": 4836,
  "create": 205,
  "link": 0,
  "cost_ceiling": 0.25541
 },
 "T5": {
  "members": [
   "2024__part-00001",
   "2024__part-00002"
  ],
  "docs": 180,
  "chunks": 3925,
  "create": 180,
  "link": 0,
  "cost_ceiling": 0.207631
 }
}
KEYS = {
 "T1": "7b347edbbd0d358ec,a4fcf9ea7275856fc,f86d7073b51c4863c,2f2b9b57e25445e7c,487c700b504fca03c,4c12a79b9c025227c,719e9b3b1a2d4ab0c,9e2e062db0e5614ec,b13eb5a41a128b93c,cd479bc72eb119cec,d76e6fb852665136c,c09ec665984eca41c,ce47643b44750b4ec,2319e385024df6cec,404386688c05cdd3c,540ab86f11d814e5c,54fe699a7266902ac,588c97218bea34fac,68fd8317db72c009c,6ce94a7122b88eddc,b55b06782d44a13ac,f54ead8e14875164c,fe42452bf1fe5a61c,23cc2a793743e88fc,39f4b38a8b430f65c,3c9f4154d7ce3931c,3d170cc96805efd8c,602d964a849788c6c,b85ef6dd3835c72cc,134ee317f1c0299dc,2e97e40566a1c10ac,31c9351022106e15c,3502b0216c565ce0c,41f878f1eda1463ac,57b22afd87352f10c,706c0ed6b7ea9cdfc,7e1fe425f2a04575c,8184495668812ebcc,949a8c8a510156b9c,a9ee00b805299cbcc,d0a16d8f41ebb4ecc,e1616403f6210065c,f87f847d21f9f2f9c,179941c2943646f5c,484ff2e18d71308ac,754a04abdbd83facc,0a512d5527773338c,1075ea83740acb91c,18f92bc99b796645c,301817a0400e7e69c,3fc20effb8821f24c,44d20fcd589218aec,527446e4362eef64c,55f07af7278231d6c,a50b76e220610dfcc,1d8a926f3b579c88c,228d82a4b05a7b02c,33c7d928dd88e971c,48c1d4a41b17fc10c,521a5e81064b96efc,a4e55d50cbd7eb5bc,ab4c0733929df457c,cb9476346a523089c,f5bbbf903fed3da2c,3980a57b92fca54dc,3f4821b5b28befd5c,4349204b78460d01c,6e092e95a1e542f8c,730886a224b8326fc,8efa75255ad3c94fc,a0064aa52436af92c,f035c5ead8a6d307c,fcc85fbc1cb36778c,288f65bb6195b303c,576225358beb7149c,60c1c4309a4edae3c,69a29a717ab7b88ec,6e4a107c2282ce7dc,ab7224b647bf616cc,c05019c6a59d7e58c,cbbce2fe2af65fe1c,20d2af3957ea3d7ac,53d0d019b95d51a2c,77060df365bd49cec,7dec26bb65c125ccc,8322e583bf24ee91c,9839049b7485281cc,b4973c7834cd9835c,bb719cd2f4e7adadc,c3f24adb312da4f7c,d26a2eda316742cfc,f4b00ddaf5522e3ec,2dea406eb42775d5c,51fd24b6f86d0d48c,6b8023c2b67f4093c,974ec87961f1e874c,a5b2654be9bbe328c,e5e40aeb7c5ceda4c,e9802bcf5369e209c,1697f9fdf354a387c,78424be925b86c3ec,a802ea4168194734c,b5f003b81fd3c912c,fe6dfd31349662a5c,37056bb10cae40f4c,3e94c2786941256dc,4c0e99dfdf10209bc,6f0fe65a3c945781c,a71ff7839d1a55b9c,b1ed2cb121b2065ac,caf7c62ba293fe1dc,da1c72b3d59dd225c,10e0d3bd9413d98fc,249e0845cd0a68efc,260fe43756abbf33c,2d2a13cc8f2bee90c,439d132597618f7ac,4fef8d63ae289ab2c,59fbfe1cf5a81259c,5d17e8691b292902c,8f76e0bd798d4909c,95567f461d875005c,cfda65540ddcd6f5c,ecfcf5f2c0600430c,f790924d89c48634c,0a1b5365c701d222c,2855c3c6b1ea9ed8c,3da0f599d9d7817ac,59d2a93c3d78429ac,6c266fe38bad5899c,709d935cc3a28154c,a806016d013637aec,c2a58be5ca7dcf1bc,cf6e24b43711f1a1c,d235f73195506e1bc,dbd1861426106cc2c,df54d808c5e72a7cc,e8f0d9bc54ccf685c,3a33c0eabc70c10ec,863d3ad96f9df9c7c,ae6414f86e23491ac,fdd805a25b68bb32c,4bce52e55b20bd33c,5add1c12fa75a04ec,7003f8c169c7dc4ec,6693f591980fe4b6c,24d077e91636e537c,8b23421fd6106bc4c,900717ebc008554ac,b86db4144bfe81f6c,df879fb2953b0159c,239fd7b248c947b3c,562480426fffb6dcc,5c05d7875498930cc,60c3714d8f1b08d7c,81ca9f2e3dc878c1c,85cf601d62a05896c,a22b165fd55c971bc,a508aa8a414b8592c,d22ed4c193814186c,3ac27e593ea63cd1c,e37c52b70fde0544c,eb16efe3a351d316c,18b9c5852cf57a7ec,207a42b1aabe19e7c,35f0e8e88147cb43c,48d92f336edbd9b3c,601f90b0fcfea9cec,6bb9ffd07e31da39c,74b34a0fb7258d00c,7659c831013b4f7bc,8d1d7d038535eae9c,8efa8db80fd4fd23c,9586d37bcfbe4b11c,9c67a1f537ae417cc,9c9a674f04aa9988c,a4bfef00c92a106dc,a4e2f22c01e58377c,b086b7617538a76ec,b9deebdccc5c57f5c,f7fc34b66993d9d5c,f801354d70aef2f8c,0c90c2640c0bae69c,0f7b819e63372483c,2cc4da2342c24228c,374b33ae52714ef1c,45fff431f1cc0b3cc,4f6ff26ca3e9d473c,55c7da79e7485376c,6196c90e226606b9c,65b1183df64522fbc,673788a3543241b1c,7aae653654594441c,7bdeb9d5e8793533c,8413638fa7ff7e19c,9b9bbc656bcee3ecc,ba55b8b9a3b540afc,f5d408e44dea90e5c,174ee56e9678e657c,17fa12a2b6edd3b2c,3f3196fa21db1b52c,a84cba83e9fc8034c,01819dbfe361d2b4c,4c49a1989e090e80c,5fb72127b013c0bec",
 "T2": "64e331fe1fcfc455c,64f8fe1a16ef16f7c,6e62b247181f7cfec,8ea33ce6ecb13852c,9339874574f2e83dc,99dc6160fcc89c3bc,a45f173f00d2b04ac,c7b750b3a17e391ac,f2a58a57a4ec5930c,f6f6b0394ebac5eac,0550d8d10249fb36c,0ae0214b762564d9c,10b13ae4155451cdc,3347aea48ee706c2c,691c365d20609897c,6f4c874260956de0c,ffa696141d4cfcfac,06241ff3d27e36fcc,5392041b6034850ac,54a494deca8f840fc,5e7b731c9ee60577c,65a6e7d469d0b356c,99cce874cef63e35c,c64b2f716f1dad37c,d511079394ae8835c,0c0d82a0930233dfc,579e52505fbfb237c,88f104777c34d63cc,3f1dd01311f0a716c,511abe4dc1500074c,7c0ab8d17053a30bc,d764919e63993519c,96ce29df9dff328cc,cb45ddb5729fbe1ac,2746a3c2217b5a46c,3caa519a9600ade5c,5753c7d7bf8d95a1c,765b7844979b734ac,7bd844821f076585c,7e6527d9e7aa8f2ec,98d6fb0beb6a7766c,2342ae3643ab3015c,23883f57c60b4c6ac,285e384ec7ebc4f3c,355bd8855305eea4c,4ca6bd6a788afa35c,5163a3fa86cdc891c,53fc43549d3f9929c,6106b1081142a221c,a3fbe335deed6728c,f20bb69433b5ccc5c,ff22591d64b0ba98c,2803ec1d27be7d2bc,4707febc80f1d8b0c,53e9f7884575b099c,541525e1c7f9a143c,762dbd6708d7b1c5c,86020e2f221513c7c,baabfb4bde4b9c64c,f03a27bd1ba38836c,07fc7b69d4e7eebfc,0fd4052182c327bbc,161e1b0270ef3150c,4823fb9fc8fd49b6c,4c366824ef162132c,597fddccc1ef4183c,932ab5b03a844a53c,bfa6d2b6eb14c1b2c,ca876b06751ae2cbc,ce8aac1c89cc07aac,f9e44b3f06520181c,0242652390ecb956c,0e18869fa72c7c48c,194c3a1f3a50a583c,274af5599216154ac,30d5212f09cf1974c,33c5bc00246eee3ac,437601379e850396c,605e6eb673d5b276c,790e82c0e9d5e2f5c,b2a2c454535ec921c,fd7842be84aa8f3dc,fefbb6c53ed7539cc,37feb5401c5f0cf0c,4ef62f5a00eb7ee9c,5142283dd1152e0dc,6c0459b2e7087763c,8c9c2c6a53157fabc,8dce95e3ceebd328c,e28f24bc8ca75403c,e94e7d30a0349a34c,fa01ef4c4bb7697ac,0b0edb3565321e72c,14af0b726c8be283c,169aef27ed246810c,17050e84ca56c82cc,18f420ad9cb19fc4c,3589ef2a7a404ef7c,5a818ca140347232c,5e80ab930c5a5d6cc,d4edad452bc6fe1cc,d7d427b4cff45685c,e89954e984a7efe8c,ee42ffaf4e2bb6bcc,101e72a50af89b90c,278d60510985d177c,2bf89e78d284cc75c,c4c8cea3230052aac,f0b267993948fa5dc,18f6de8b16c190f2c,1ba6131b96986133c,3575016ab7c9e158c,3a5cfed3b086c4d2c,3eed904dd1ddce31c,4fba83eb631a3525c,549ab18260527e08c,626af23faf20b1cfc,6784e18e87ceff43c,6ba328baf1d71da7c,7e00c1d5c88ed76ec,9855026e7cb79c27c,a7c6b8f58af3a2b5c,aada1d92f10e8fb5c,ac8da72ff7828c3cc,bacf83ce5ff1c2cdc,c70ae2a54cd39662c,f3071e94bb5e1b3ec,061877a17fb1939ec,24dcdc94202a548cc,49d22e2296c654d2c,4bec27342a8ec8a6c,5b7e925dcfebeb33c,5e8888502ab54252c,633c399549e79d87c,64c0e0555ba024d9c,73cc5125c3ecc452c,92bf87a225a026fdc,c6bcec19be1d8e3fc,f14143f478b450adc,fbdda579205b2eccc,074e7d72a5c67f07c,6fda8d2bf8832b59c,9465aeb25df2d223c,c6947e6e7dc2c10cc,13b23378dab2ca5ec,9bf308b22773789ac,add6a2a4dc18effbc,b8f202cb119593a9c,bf96fc7a79757bddc,d6faea0857d57425c,3459c694cf646580c,358b5748feb3bbbdc,8a1793868a86f59fc,a9c6222d4634d09ac,048292ea2e4c864bc,0843a73116157230c,139daa4996d9102ac,379f967bfd45ee6fc,66f2b638b803659cc,786097f5b2a8843fc,1900983e430f4be9c,84f3ad85f789e991c,d2a41a788cae7b65c,dbf70752ba6cc816c,dcf4e7e2e1bc9bd0c,f59b4df26ff39824c,12ae24f1f83a9c17c,3729e5d471b69962c,66ee7d2830fab608c,8540fe22fe5ac8c4c,b1c737fd956a617ec,d05f097fd4c2bcbfc,dfac81fdbfaf375ac,385a5c364391aa58c,144d2f72dc899f39c,724f9a708f1169afc,7f448a0326608c50c,b2a1fdac03d2b5e8c,c5029300b3c26d12c,6c8a36644f970d1fc,974fbe671cb372d4c,9ffac4180b59f279c,ce80eae3fd533f89c,d67ddb74f11ef2f6c,0720f69e6979af0ac,3c0a8193eb83cff0c,91d073cb0f4382ccc,b6670775deaccf7fc,f5021c4d70074696c,f57fa0a288542374c,1e67563fe33acce3c,4e1e700c185abd41c,5c0efc302f6bc714c,74ffcb4e493ed3a9c,7f8477f2283a9728c,b65fdaad49eaeb9cc,cb3888e2d7f45032c,c89e6806a12b43a9c,cbd05d8d0171d403c,0133f73d344f9086c,8510f0f51d3cfa56c,8d8239ff9e4c6c32c,d5d398242401313ac,e89801463faf509fc,ecb36ab13eedc8e7c",
 "T3": "0700ea220bbaa71fc,11c58091b5577443c,233e62ab0ee09f27c,33fd81de033a9b1ec,6114a85a6030ae59c,66f53ea9f9741987c,7588f4ffe6e19b1bc,82ec9793d95fed61c,970521fbd64fff1cc,9cffe209e77db5a3c,dd4b7c5d9609a96fc,f58a451b44451928c,48f07ba03f86bcf2c,6fa8e06f090a4a6bc,1812aae4eea85ad2c,604cd29884868d94c,6d6ba64145e34fd9c,738bc6e46b8b5b9bc,de772877cce1f982c,8bffe27e266e683dc,b7ead1f3e5f56858c,d236bfb75e2125acc,e51a79233fccdcccc,7175bc52dc51a015c,a1b2ff72bbc8be80c,c1a200504a9aefe2c,d8821758b8f0e05bc,07e20798e052b22dc,32fd1c4053d7f6b2c,3f2f75d9950a867ac,4b1c079e1e8a13e5c,89099f26ccd34edac,f9d5de70a0e247dcc,34fb8403be5fa77ec,a6b69187a8c36a89c,b34d8cbc04020626c,c3f193c360b32f09c,fe53501c286208b3c,29a0f5fb7d253558c,5b5ff8d321c5bb6bc,8d3b271c376027e2c,959f9961a67836afc,a75f78cec9f98d4cc,a9645e415eb52a39c,08f676034aba8384c,3735eb5098f4e981c,47c9b7a5a58d974bc,49c5046f9333fa85c,8092cdd31623e0b9c,8ff69d29af88b87dc,a72f4a53c9c8e295c,bf637e121a54347ac,ced881ee2ba586abc,3859f8b0e6eca5a8c,41a0407d759825adc,68f68abe12800f90c,d20220dac530b05fc,d43ba19a1b3ba274c,e89f5527d2f17156c,246dc2943f1a9eb0c,3c3a9c4ae4197299c,7d46e3b96d26aa26c,8e5be9220715d6cac,c11a3079e2243e31c,c63d55c5c6507b20c,d348293cde83432cc,e8b5886f0b43d84dc,f5c162a66b3c20f4c,1b1531b68b4b103cc,6932d95fa657824cc,d15d6c1b09318e05c,e9ba437e73c29892c,08c44a7eb074548fc,0a2cd15577356d88c,39a019a889969d64c,7bdc6d61f4193535c,8143f079995f7e51c,baebe9d05b4ef5bdc,d26f4df96b744f0ac,ea27e8ec4ed51bd2c,01f681a7be1a51d2c,0903c0acffa8248fc,0f2101ec9ec8f16ac,1265c27965ee9c3dc,28ab0dc5821fd421c,2ace842f2ab07677c,3aa163d994acaef0c,58c1ae9d535578c3c,7b88c3b3c7eb76fec,8397869680e7aebcc,ae74a0ded94184aac,bd95ca85e5830bbcc,bd98a5b47bf482d8c,c7e4b485a16ccbbac,cc777997d5c27e08c,d8b2375f37143df8c,e0020a760d5fc47dc,f1df21cb2887904bc,f56e02d80bb7fed1c,f7b418c5b0bd3284c,ff3fbace444cc72ac,0477d208b73a4d65c,144a3281ebf44102c,1451a8f01e5166edc,38a95bc4978b3407c,6ba6bca8f492666ec,75e71f2f61b351cdc,7822f65316bfdcbbc,7a067b64c3b06c33c,7fc2a1588a7232b3c,c0678817da864129c,cb13f60bd03a68d3c,deaa70c1568b98bdc,fefd1c2bc4ced217c,1951c0401a12cee4c,28ab3d7b66e31239c,3fab13900b94fc58c,4c4987b7c292cc8bc,505c5667d44a272ec,50b2e781f1cc1544c,90ec555097ac2a2ec,93e90164121ed7bfc,af0e6a8ca2e4ab93c,bc13a6ea0765e9dac,be2015b31281ab83c,c2248b23b6af3c75c,e69649b4f8e54a4ec,f1a6bfc7add198cec,046e69e1be2d1e65c,065a6c132e98bc92c,112b61e226a7e2dac,1ca5f52c79fb31f7c,2eafee265b4d9472c,3278dd4a014eab46c,3f472ee73cdfcc5ec,44b170f056dec388c,5063b4c736bdaa3ec,63fbaa8ce75041efc,6486d05772dd3fc1c,75d7f3adb7783a12c,80362814f70b232fc,8c627b90e74ee1d7c,984109bf5ec82584c,a044c8472625ec8cc,b259a32b10c6ea02c,ca39567ceef38cb2c,ce48f6f046dd0038c,d12c04281aad3a37c,fef11e67dc6be959c,028c941302c03794c,2819148910dcb0c9c,39a7d74101e9c9cec,57df43ac550128afc,5f85650744ee8348c,81d5da3cee70c3dcc,85ce5c503e5b4a16c,86a694f01509e557c,873ba8b20e35d2c8c,88d80775f0e359c5c,88f0ea760c1ff39cc,922f036a3ea0cd49c,96b81778dddb902ac,97cf7cd6f341e587c,a65f20a7988e81a0c,b633f1aaaa96c0bdc,b86cfb8bc6340ccfc,bc470f92c060ba26c,ec645723939e6705c,21ce87e202a64a19c,38c21389351c139dc,3b7a0e699cbf1974c,4bd8279551e5890bc,4f9d2f2c3b757ed9c,5035dccb9f338788c,57a13c4d5567bae7c,754b3b9f9a620f6dc,816ca98d8dff28c2c,86b755e1f4bff6e5c,aa8ace9300f97f80c,b0c283b664eaeab3c,b77f3f5470dd7ee8c,cb63065ce5a3680cc,e803ed6dcedd4900c,ebaf3ed06b8fed5dc,ee8f1759f16fc06ec,f569e3cc8731e2e4c,f80b3319e1cce8acc,0507fc053a1e1810c,0755e9623f5a7c36c,10c507159ee07e2dc,1173f529eea413fcc,1840b68da830ebb0c,24b6250f35051bfbc,32307ade69966939c,33043f67f292a78ac,43890b040a042631c,4ff1785a796b2e6fc,52e90c5f0caa2ee6c,53c7be50d58d0af8c,64158f85152f4876c,741c54a912e11534c,785be9b0e4ee0cddc,848b1136c0c96fb4c,8caa72e052c86a53c,d78e01ba355f1ac9c",
 "T4": "f218a035ac3bb65ac,f386243a82459868c,fcea6669e0f02594c,0a837803bfbf5e6ac,10efcf3355bf007ac,14a241642ff1dd35c,20c214e8ac454fb0c,2302af431f0c4b99c,2b1e87ef4203e618c,34008309a2b7ed54c,39b9b3949866db0dc,404823643e14310bc,56f8d32568e34e66c,63f4700e9e7a2e02c,68a6783668ea3743c,70549add64e52b50c,8fd9e4971cf0e842c,90fa0650f9780d4cc,951a005982d8d1f4c,cf9731dfce972684c,d1f2153ef1fa41a7c,d9d311dcc2080920c,dad4027367412e18c,e31f77f1ceee66a6c,e334a75dc9aeed4dc,f7d6e1b94891deffc,fb411cd77f60a3a8c,16d5f87d1b2691b8c,2e75583fdb8effbfc,2ed6d84bad8fc00ec,311f6b03ac24c6a4c,383141e2a59ce3e6c,5b6127776d2c6e88c,5fa281c7617ba625c,6214e5fa070db3c1c,66383a36f9bd369cc,7376b619d97dfca7c,87bf39f2166f8b36c,a277db3477a53a3ac,a60b29ad17318301c,a764dc5c059b22a9c,abf4f1f78e6a11dbc,addec7593d341cf4c,af2f309009e2bd60c,bcb5d8c6f188b37dc,cc58b3e9b3b6ca48c,cd079b864ca36509c,d9d1c45a455170a9c,db59677c4e01df5cc,e0664abff667e528c,f6c62556340b4660c,f9c554ca15857120c,fd5b7ee29e207950c,201332fa66fc908cc,4dcff64a1b11218dc,596644143fc2dbd9c,63b7dce00c573797c,98e73712dacf8a61c,c505c047f8643b02c,d168887cd6d9b4aec,d7afa35e8340535dc,e26ab6c2ed03241ac,e6e8cb66819fc1c5c,e95528a9949714cec,ee1dbaab37a303a5c,f1a4e02fc8ba5613c,f5ee35e0b860ade6c,f9c005a3db9a7e5ac,fbd628417d13c3b2c,0c7815305a4fba66c,177daa165876d9f2c,1a88eb6e70d6711fc,1c8858dc75d5b98fc,21b613fadcfc920dc,2c8c2cc93c0b6161c,42b7fbbd0644fb19c,43326a6db89dc2cbc,43f0fe7e1312fc2dc,58b12c6c4d6026a8c,ae976e92c25f982cc,b0fc490c3d3d1cf7c,b8184ea15b826572c,d66aa7ad945bb1b0c,042761f3ce3afb32c,08929565060f6936c,1ef6f5fc897527b3c,241ad978bad33e33c,247689213d6debbfc,6203fec44d90f5cfc,6fe9daf87e53e446c,7d69a4a0a42e1db5c,8e1e54b473e7f418c,a011abf785650c20c,a249066c760c5bdbc,bbe627087ddc3a2cc,d4f057f1589ce907c,de9c064c17081bbec,df8b4f26d9488b05c,e21da58142b827eec,e5150a9e3e0fc3b1c,e9242bfcc46f360bc,e95b85d3bab67b0fc,eac871c36eda5b14c,f09a7ea28772cde1c,fe5d39f51a9f3397c,335c4f91012be25cc,4a36bc2495874ba2c,4e712658a76150dac,97110e91adce0e33c,c25adc4766c142e4c,dd827dd7a0f3ee13c,03718c79359bb387c,086befa97ecf3984c,1e095a63c54910a3c,1f65a40a9a192343c,29138f29be0cb13fc,653387ade46a6e70c,6b6c2b111d82af8dc,7a957edab512c8bcc,7c89755acdab5e2ec,82e52315c7b68211c,8f641fb30842ad66c,98c165caae09632fc,a3850ba2ea76884cc,0f8518418ff656ecc,1b5c6f46f90b0bbac,4b5dbfe192262725c,5401b0f9cf722decc,a752377774652ec3c,ede435045e03f31fc,0cbbbbcbc29167cac,2c6240948d2b9e37c,2d2dfc4f956d9cd9c,36640ba27e69929ac,3903b5a748f12bdac,3dcb00f06a0931afc,8b2a9c95b91940b1c,b27c96b910c8b0abc,b8671b5ef6c0d5aac,eb3e8158a406651cc,eee7c724bd65284dc,1bd4b8dc9af6b23bc,1ded7d6c80db03ddc,24d4c2e106815449c,31457d5e011e8d47c,3a6158f5f3affc62c,40cca7379168b3bfc,46ce681dbecde1eec,65ea796c0d488a81c,7138719e423e92dcc,71905efeab25d9a6c,73151f29b6e6476fc,7cdfb0f298aa8d0dc,94a514e38f812d65c,b359a81ee08eb2d0c,d35b685938f92b6ec,deceaf96a5118a1ac,eca0f6790d7eb6d5c,fd9b9bcee7a15031c,03a09243267a2f66c,03b3f31a0f6d470ec,06cf1d607b74e5fdc,09ab4e841be82c27c,09aca0d3c8821846c,0e7d3292081cbee3c,117faf6202047924c,2d00491b46deb8d9c,2edf0be1ee10b507c,33b22009497ade86c,43441e58398e8252c,47058f13acc8b067c,50d65a129010bb0dc,553f62bab23612bdc,66725357dc8e1a3ac,6747d098d3dba1aec,7d972a37a3ffc4a8c,84becd81ecc8b616c,84ce1f567f97aed4c,8b64ed223fc9a547c,aceb5edf5618775ac,b667c0fb1136f208c,bb15ed871d288bf4c,c103a3b3fb5f1fe7c,d6de3c64c68c097cc,dd95a679fd8ada9fc,e4817358707b2b00c,e73050f4d41b1230c,ecb1075e20925331c,10f854a7f889ebc3c,46fb447c75209da1c,544ac023a2e76e9bc,63accb082d7a7db0c,722e8e2e3d8c4427c,9edd1ca9acadcd15c,abd4b0a4b9fa9a78c,b1f9e3dc2012fb08c,c8708329aaa41b95c,e0966c096c405c48c,f4847bc780697760c,1441d9090669dcb1c,19f530c6277e41ccc,1c2bcfa38cb9ba82c,1faabc82f7278355c,430fcc210883371ec,559e05f5cddb77c7c",
 "T5": "64ccb989d3a2892ec,69c8f28b6c9a317dc,7de07f24921a7a55c,994da2e5567cbb53c,a39c8aa1c72b9bfdc,adbe5292855bd4c0c,e7541b7d6e55206fc,0ffa8ffc05001d97c,124efa51e96e2a22c,24edb34138adf941c,3193cdc024cfad24c,5aae97976638aca9c,7558fa0d2b76cd05c,799d9d76d24f5243c,7faff900fb5f5e64c,8e6e7a52f8eec2a6c,917a9504040bebd4c,f52521b4419d0cf1c,025c14e382a114abc,03d90dcc1d46aa6dc,045c480152dced37c,0b5ccb1fbac35e0bc,120d9f74e9db2fa7c,15337613c906fdbfc,22a12c19b71c49f4c,3cc04c37ca5cac69c,759087ff83d7f367c,8bcdeb40fdf512c8c,8bf6761e0a294b3ac,99f2389ea253679cc,b0d1e44767988f03c,b85e79d3183f6de0c,09bdba093fb3618fc,0efad0370739e810c,2acdd4b6e1cfe636c,34eaa3d8bec87a3cc,3d39f977ac69e59fc,3efd09973b1a1944c,428fd6ca58ab68f8c,4c885b38ad63c2afc,5ad3ba3727db2622c,8f5774616d6a0841c,c1dbd7b5afa7e53bc,c6e54c00c814eecdc,e4df6afdbf88d4e5c,f107ebd2628eaa22c,f74f151b2ae1887cc,f7ea27dcb6d58ad8c,f9413ab0e579efc1c,052006a41a5a0320c,07cf0383e56c7ed4c,0e219ffb9f6e7e60c,1eb42cdb21f46004c,54f7ebf7de2c1165c,62b994a45c9e8679c,65fc895cee820901c,6d341cec4b1611b4c,7c253c2243fa7c1ac,7ea60842903d477bc,a626855735ddd6aec,b452be22e3b903bcc,c4db41a70570bc66c,ca32a26a6cc6979ec,e4fdf41230af7eb2c,fe0f355bdab3103fc,034aaf8464850ca9c,15fcbf7867c39f65c,3df87c6d68206463c,50294de40bca27b4c,748ec8573f9868bbc,86d49a4b1368fbf7c,890aa169203045d1c,960d20f75ea17414c,9bde5d1dbd2e4c4fc,e31850075f73c8c9c,e3998c0f9f118e98c,e9a957de363afc11c,05ac4a26acea7ed3c,236033fc93524e5ec,2a60f8b57a185364c,34daf8f4af79f422c,3abe4f29c78f04cbc,43001e164de5f8cac,550131938be60cddc,5782ddd411785402c,66c2097fb1088c19c,6fb7b81a207b058dc,9f4b630685e395abc,9fd351793f011302c,a26b1457bbcaa886c,b8bc31c7fcd7d5e6c,baddc6a32e908c36c,ce9c5ee1b7336da2c,d3d45504d5cf9537c,d3f90a4b28612c48c,e17b6d1bf6bcc8e0c,e79a8576803daf0fc,f3342d9aafbb4b60c,fc44b9ab5a2c5d3fc,fd4eb123d9491ca5c,1aeadcc6bd33cd3cc,3a0af301f7c34f4cc,91870adae29baa56c,aab7f01a9ea6a633c,bf5f809dc5fad306c,cb22de4f5f242503c,d8aac36427c931e2c,ec82bd0022633520c,ef0c4184cc6b31f2c,f9b46ad9308b883fc,fed1ee550f6440e2c,052b2473d2654c41c,0dc6ab04e7078db1c,228df1bcd8da9e39c,245334e3b4b0034fc,34842973ea76f394c,3ea73b2bcf6581a6c,48ada0b6fe4a035dc,496c491b4b6ac63ec,4f645c7ab0ddc6e4c,53b8c45f84c0e018c,64243eeb480f1bbbc,7176cd09b7864926c,8033e8bfac245b52c,8c6cde0461a6dd1dc,946152da395a440fc,997aad6c2e4c5230c,9a3971b7e98f372cc,9f1647d805718efbc,a3390775fff264c0c,a5df5ddd3942feeec,a7814353aa43e9bac,a8165ba9d20685b2c,ac8af41dee880e80c,acec1b60b8754288c,b4b6bf9ae1e2e399c,c2a1b5a36125fa1dc,c66a7fced3135b44c,d24b39ef4af7269fc,d44b6ecd6f1e9426c,d47e22bb06bf9ce8c,f84b474de232749bc,fd4955e5159b9bc9c,0141e6acd172123cc,0b8b63d36f64eec7c,1d30712810223f94c,2de7fd630c30a14bc,30eb6fe8603d504ec,47f8884d680307f1c,514c563cf422d547c,66a93e6f5ef00b38c,6fbec118f9737609c,b8d946db53d99d31c,cf32c94965f9a3e8c,ec20200d5220951fc,ff96f313a4cb8ebac,21b2a63928d37d71c,685ae4051fad4a0ec,6dcc919fa915ad47c,7958fa01a993d7dac,92361007fe91ed99c,9916277677f019d4c,9df068208b611006c,b26527f2749e736ec,bae218e0309ace0cc,c6976bd219618d68c,ca3117b1b8ebc470c,eaf496dc261cefc7c,f7c84e4f0bdd2245c,08d8208797effa7dc,0ea5526fa4d3bb83c,1592f341d4dcb628c,1b46eb33eef01198c,2b2fd4240cdccb22c,2c2d58c16a5aeb95c,5d25b2502342b7e6c,6ba2f1f9a04cc5b1c,6e5682e11be67241c,76ed9bf9dd764fc7c,7df002fbea1531d5c"
}
TOTAL_DOCS, TOTAL_CHUNKS = 1000, 30973
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
             '--output', o, '--decision-id', f"{DECISION}-{t.lower()}-{m[:4]}p{m[-5:]}", '--approved-by', APPROVER, '--keys', *keys])
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
