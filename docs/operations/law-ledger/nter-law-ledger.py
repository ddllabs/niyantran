
# --- Audit ledger of ingested Law files (read-only DB export above, pasted verbatim) -> CSV + Google Sheet in Drive ---
import csv, hashlib, io, json, os, pathlib, datetime
import base64, gzip
L = json.loads(LEDGER_RAW)
if 'gz_b64' in L:  # large exports travel gzip+base64 compressed; the md5 is over the original JSON text
    L['rows'] = gzip.decompress(base64.b64decode(L['gz_b64'])).decode('utf-8')
assert hashlib.md5(L['rows'].encode()).hexdigest() == L['md5'] and len(L['rows']) == L['len'], 'export damaged in transfer'
ROWS = json.loads(L['rows']); assert len(ROWS) == L['n']
BATCHES = {
 'owner-authorized-20261023-law-five': {'batch': 'B1 pilot (5)', 'approver': 'owner (name not recorded in pilot evidence)', 'authorized': '2026-10-23',
   'receipt': 'docs/operations/law-five-release/'},
 'owner-authorized-20261023-law-cohort-2': {'batch': 'B2 cohort-2 (5)', 'approver': 'Vighnesh Shukla', 'authorized': '2026-10-23',
   'receipt': 'docs/operations/law-cohort-2-release/', 'manifest': '79760acea597716f6bf295a44479d3ac60d0c8ebf4f1725908bffab8074054ef'},
 'owner-authorized-20261024-law-next-100': {'batch': 'B3 next-100 (100)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-24 04:13 IST',
   'receipt': 'docs/operations/law-next-100-release/', 'manifest': 'af57c78d478048c6c06afba6d76e41ed76ae5f0dd52384200424a2d71920d13b'},
}
NEXT1000 = {'batch': 'B4 next-1000 (1000)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-24 14:16 IST',
            'receipt': 'docs/operations/law-next-1000-release/',
            'manifest': 'T1 ed83e437f7839ab5d9fc8b6094909d4704220a5e77b293d6291a103a4d52f29a; T2 972e95b1a856839e42393206bc9b6a119584944c896d0062edd1783f95fd5506; '
                        'T3 dd46363712c898ec9278f4f3f00382cf9555869461dd35b79479094d187f7a9e; T4 5921dce57bfbc840f52af35d38cdd8ed5c7db443d846401089279c5788755354'}
BATCH5 = {'batch': 'B5 batch-5 (1000, 2025 orders)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-26 03:47 IST',
          'receipt': 'docs/operations/law-batch-5-release/',
          'manifest': 'T1 aae686d491f3a011599930b763125a780ab38bdd812c76b7bb104efe558bd8c5; T2 295135caa07f82034ecc8b1df401652b5e8b9b80de5c996d81b7f462d7044e0a; '
                      'T3 8e7a51591f1770e4bdc12bc679d716d2d3f4e3efd1a67c0b6a2a1c50b22466aa; T4 40ce77f897f0fddda882f089c3cfeae82dfee50aa1603b6592ac2b4df33a61c4; '
                      'T5 c76eeb95f4d5821b70185fcb84edda8d338e365e60f7c0197e201d63f33356be'}
BATCH6 = {'batch': 'B6 batch-6 (1000, 2025 + 2024 orders)', 'approver': 'Vighnesh Shukla (relayed by Tamanesh Kauri)', 'authorized': '2026-10-26 16:29 IST',
          'receipt': 'docs/operations/law-batch-6-release/',
          'manifest': 'T1 146739f44772e2a87b0ced0bd3b235764ac21cd3bd411bfcd1d9c83f47e834dd; T2 2f2b0262982a5bdefe4f211ae01f85d14d34a9df2d733cb17621621ecf05ccf3; '
                      'T3 59bc3f9963b75c0d84e631c5c2d273725d1a62f5868f0bba882d404a6b70e498; T4 8cfbec56790e42011c62292e72892f0296cb5e526a2bf57c23f8aae7d93237e2; '
                      'T5 338c70aeb0c2145beef4c620bcca702e2380bfe797519c254e2613030a56771a'}
AUTO = {
 7: {'batch': 'B7 autopilot (1000, 2024 orders)', 'approver': 'Tamanesh Kauri (standing approval for batches 7-11)', 'authorized': '2026-10-26 21:07 IST',
     'receipt': 'docs/operations/law-batch-7-release/', 'manifest': 'T1 7f1a53a2c8979d34f86b362432bcfbbffb8a54160ba8a3060a61e09def57cde7; T2 1b99de34fb1556328db275a8beea092e29aff46a9c29b1ef5594bfeb90b39df7; T3 8a43a743d7fe261c746e9c93f314d3c4728cd0845a95f8465dd61b0ad09a3c47; T4 1e9694f53e78f02fd135429ce5b80274b686dfa3139590048758af453b5405fb; T5 64bdf9b1c96a823541ecc28414f3f7fcc42db2efaaa5e2fe53774ca551889300'},
 8: {'batch': 'B8 autopilot (1000, 2024 + 2023 orders)', 'approver': 'Tamanesh Kauri (standing approval for batches 7-11)', 'authorized': '2026-10-26 21:07 IST',
     'receipt': 'docs/operations/law-batch-8-release/', 'manifest': 'T1 a1b5730477d1257a33c283ce37a4540ecbff8dd6d3214fe614dfaa9f2f577df1; T2 60d4f1a8d63d6d6c91b4e62301d94e04b0b6c3b469ff0b1fced0ef16406747dd; T3 6f20576d3e66861a1c6bc626791e56d2bd3bcccdbb1d5fac1e00e6e221af0c30; T4 9cc589c2412d43aa657b0d3a511bf2856cf01a7b004573580a111110a4e29054; T5 3ff5d0cf04971614159ad32e8866122559ba5c9270c73d36b3c5acca3cd981bf'},
 9: {'batch': 'B9 autopilot (1000, 2023 orders)', 'approver': 'Tamanesh Kauri (standing approval for batches 7-11)', 'authorized': '2026-10-26 21:07 IST',
     'receipt': 'docs/operations/law-batch-9-release/', 'manifest': 'T1 e711a84f824466059cd5b650dbffb728e73559eebcd59667e4607cf459c18f86; T2 e7ac10714ecf2489f4ac5f21145c0adba2457cc83e3cd1b3c20b25e01b693b80; T3 78ee235aa9df53f01d3423dbd4d0af6a402c9b8655a149010a2b5633ce818f5d; T4 efa7f24a19b2983a29d139c42b85b53f4ae5f256cde2513eeb429cbf4f8fbee3; T5 ef4c7747f03d9d5be62ab02cfd09f2f122d13538895bbb77e5c0f75eb4114a96'},
 10: {'batch': 'B10 autopilot (1000, 2023 + 2022 orders)', 'approver': 'Tamanesh Kauri (standing approval for batches 7-11)', 'authorized': '2026-10-26 21:07 IST',
     'receipt': 'docs/operations/law-batch-10-release/', 'manifest': 'T1 e2a4c6d9dcff43c5b7bd6735d20ff9eac7201e9c713b290a7cffc05504f2b0f6; T2 0c68bcff42a9e230355184a60db0ab37e80f6dc93ee71fca1318290aaf9caec7; T3 82871cb8ab4d566a203c84f7d1181421faacbf6a28fea5009b03e36b1d77a527; T4 05f086ce224299471b0e4b4fdbaa54c5359268072ac9fa4d870b43fb92dc0509; T5 d452ec0b09267e00a596413c48677dcc70ae20a0c9e0c9f92365298c550441df'},
 11: {'batch': 'B11 autopilot (439, 2022-2017 orders; pack exhausted)', 'approver': 'Tamanesh Kauri (standing approval for batches 7-11)', 'authorized': '2026-10-26 21:07 IST',
     'receipt': 'docs/operations/law-batch-11-release/', 'manifest': 'T1 7332926341e0629b3f42f4701a3a05aa10f311c661f790155cf8440f0ce8126d; T2 fe5b3698378804712633bfb9d990ee9153a4a8daece488f35462d819b5f0c9a8'},
}
def batch_of(bdec):
    if str(bdec).startswith('owner-authorized-20261024-law-next-1000'):
        return 'owner-authorized-20261024-law-next-1000', NEXT1000
    if str(bdec).startswith('owner-authorized-20261026-law-batch-5'):
        return 'owner-authorized-20261026-law-batch-5', BATCH5
    if str(bdec).startswith('owner-authorized-20261026-law-batch-6'):
        return 'owner-authorized-20261026-law-batch-6', BATCH6
    for n, b in AUTO.items():
        k = f'owner-authorized-20261026-law-auto-b{n:02d}'
        if str(bdec) == k or str(bdec).startswith(k + '-'):
            return k, b
    return bdec, BATCHES.get(bdec, {'batch': bdec, 'approver': ''})
FILEMAP = {'292e68e44a755cf869b54daab8025218cb064dac182c600f56659e69f62c68d1': '2026__part-00006.jsonl.gz (pilot extract)',
           'bc374a90f1c60313d68015845cbe1d2a5583c86c03ea0c4ab3b04f41f324d5f6': '2026__part-00006.jsonl.gz',
           'ed53e061e26b0c7e74f00b7914a2b5d4147edb4b3de649e0dba298e9f5b1e128': '2026__part-00006.jsonl.gz',
           'a35d23a00b7209a776f63da02d0ed9126bd1f2e14bb5acfb8d4f4ddd4edbce99': '2026__part-00001.jsonl.gz',
           '8c1ae33745e061750eeac8aef38fdf96a51957eec7ea9eec347a97128d3cc977': '2026__part-00002.jsonl.gz',
           'ddcae790af29d774cd47533bdfa26304117c6c74e37bacdd1e40568c0316e1d3': '2026__part-00003.jsonl.gz',
           '93137c186c0ee8e49534055050e5072110bbbe9de9a145b0b7270d5fcfa2d820': '2026__part-00004.jsonl.gz',
           'd998f34146409c1afe1dff5e43e15bc70a405ca7fda960452c4c283c436820b4': '2026__part-00005.jsonl.gz',
           'ee85b8f7b25f1545b0c29b33848f98448c0dcfa3403b0ff7240e9231248e76af': '2026__part-00008.jsonl.gz',
           'f6f70f2b9d558a940f69b5ad63b37aafe9863f9c67996690514986b397249e9e': '2026__part-00007.jsonl.gz',
           'f38a16fd9a06f5112fc8eb598643368bb3e3463cb9ee6bcadac032b49163e455': '2025__part-00001.jsonl.gz',
           'cd174623f96ac6a22c0802db7be0d4096630e6e376cf873f5976e5f358efc51a': '2025__part-00002.jsonl.gz',
           'e26d94bf27b5deda25bd333847197bebafe379ee31cd50780b9503e3a0c801b0': '2025__part-00003.jsonl.gz',
           'aaf6f336af897b4ca2ebd788ef613ad20faa56fac8524da2e90d22aba9afda3b': '2025__part-00004.jsonl.gz',
           'e032ce024ccf70fccbcca07fdba85c1840834ace92a74d6476614c1fd7e89fac': '2025__part-00005.jsonl.gz',
           'c7fd10414c53268b0acbfc1e544c12bad7a0d61abbef930d71de10b400f414ac': '2025__part-00006.jsonl.gz',
           'fac94f639cf270279f5d9214e039d4219f778bf5129b6c30107cbeeb58fe66bf': '2025__part-00006.jsonl.gz',
           '8f4eb24503bcdeb9a7c85eb77897d456fd33625cb4e97dc0bee6e414588ef23b': '2025__part-00007.jsonl.gz',
           '3ac8ba8646526146efbd0575cba19a32a4ebbd905bdb063a56cc9197bb92053a': '2025__part-00008.jsonl.gz',
           '373a0b6a9687c245607060d92aa6d04da2dfe10c2a85a592ded27e5d73430af9': '2025__part-00009.jsonl.gz',
           'ef45b44a8fa496404c1476fde3426e211bc0ef1cad830aa8821b97ecbc494990': '2024__part-00001.jsonl.gz',
           '089986abb89e85d14054004ed8672beccd12e278fe2307d724a78d8e9f24923d': '2024__part-00002.jsonl.gz'}
FILEMAP.update({  # autopilot batches 7-11: candidates file of each screened pack member
    '151ff77d013a5f5a04575a609c0ba9baa215be8df9ba2c8d6d1b75a191e1e7cb': '2024__part-00001.jsonl.gz',
    '3c4625c5d4977c18266713a9684ca6f2a4d3d691d443f4612c7226e734c94963': '2024__part-00002.jsonl.gz',
    'a316ff4c326a4aa80174be33c2ff651d8b319a60090608a61ca446fc019a9a53': '2024__part-00003.jsonl.gz',
    '458cd4e2bf462a3926e938f0bf57bdfa8b2bf8f6d4ffd0436a5ff8c485b5dd16': '2024__part-00004.jsonl.gz',
    'ca93782911b13b0018073881f4adb463e0b4d636036e3f34d7c303734dbacc49': '2024__part-00005.jsonl.gz',
    '83f19b468f28bd666383161c897fee3afd699a8613593ccb229de2b22ac2ac27': '2024__part-00005.jsonl.gz',
    'abd9ea098f46ea12a08e3a05d19723410a960b5632ebf145fd6f4671a1b075a3': '2024__part-00006.jsonl.gz',
    '50189bf5d9beb6d0a1d24a558db50c09cf8bdd2c35492395dfc976924bf8352f': '2024__part-00007.jsonl.gz',
    '6cc4dadc40a26303fd7bc922059d97966945711c07b545ed851b0551562e8d20': '2024__part-00008.jsonl.gz',
    '8315328b552a19dc8cde1eef8811992ff6eb69118d840a7deff8e0c73cf6b011': '2024__part-00009.jsonl.gz',
    'b99a1f57627b50315f9cd895f88a0673659cea7368c46e1e10095883c5d9c7f6': '2024__part-00010.jsonl.gz',
    '8c5d53fb91f5f05211e92bd18be156483bbb8238935b73083ecd5696c38df118': '2023__part-00001.jsonl.gz',
    '476ad63c67f40a8d4e28a5cb1f1c81a5a7bb3c142ea50c90baaa0b8dcea4aa35': '2023__part-00001.jsonl.gz',
    '8684b186dd3e967d21ac08106dc13e6b566f448a968b59b19e3cf3741de24dbb': '2023__part-00002.jsonl.gz',
    '144a68a1859e8d3533604943dce124355bebf91e8286da74fd841f6a36ff141d': '2023__part-00003.jsonl.gz',
    'a4ea3aed457a69dac2c254ead3fcb235ab1e4957143e7dc6b3427da14ca0205e': '2023__part-00004.jsonl.gz',
    '98675ea122fc34c316c8363f3a38e6b49e4b1a11969e13b14c2cbe26c7442371': '2023__part-00005.jsonl.gz',
    '0b88742404cb40b7fcc80f0884d36f2b9b962b0bd7e4497b3b18903b81385e0e': '2023__part-00006.jsonl.gz',
    'c1bbe1af655b4411529df2a76af39ccb852608ff5cb7565883ea5e1713b48946': '2023__part-00007.jsonl.gz',
    'fa54fc510ee7dc7ed53c9ce165f1245e9832f279c62e96311d48ad7458e3e8e5': '2023__part-00008.jsonl.gz',
    '2846d1120e0b78645b1d2f6337e90bc8e1b020a64eb2d7f719ab80dcdccd669e': '2023__part-00009.jsonl.gz',
    '1f29381e3efd7152844fa91c6ec371f6bc8f8ffdd02d36baddf8c68dddf887ca': '2023__part-00009.jsonl.gz',
    '4ddfe0750297d9ddeb693ea99a5a9e3f30cbb3109e4557e3cd766e3bc6c11d20': '2023__part-00010.jsonl.gz',
    '05c7b658161e9f67c1752f738055eccfce75a90cbe04b99fed1a23920d04359a': '2023__part-00011.jsonl.gz',
    'd21f4bb611d2c6148c7455db53e3a6f2fbc3869d3d5c45446160b4f9b6669d40': '2023__part-00012.jsonl.gz',
    'b463dee3d7ced5db7b08fc387f2ff41bc3ff8f894e5736ba172aa54e90693456': '2023__part-00013.jsonl.gz',
    'b34933ba986a7666e222fa4d3e56fdae4713e5a8de9cd91f6a56182e222db771': '2022__part-00001.jsonl.gz',
    'ee433c3144236026ee2875c0f51a9ca356b5bc06e238b9696265f5b24b12bf24': '2022__part-00002.jsonl.gz',
    'bfe63aa0f93fdc9832db241c002b469588f10b81366b140977c1feda5cd77dd7': '2022__part-00003.jsonl.gz',
    '5914df11bdbd26cd64c189dbddb1b914ae2c7aaab592c08e02651be105818949': '2022__part-00004.jsonl.gz',
    'd956d03f97be1c377ee566a49fbaba6e2e968079f0678a4b30199b209ec2643f': '2022__part-00005.jsonl.gz',
    '5ea4012f2f6ce78588101b6d35c313b74c3ab6a8b9f09d2144a5cc8ea9aad9b9': '2022__part-00006.jsonl.gz',
    '587b5ccc33adcd59f33fa067d4cd2675f66d58a023adcb33f50b324665abc345': '2022__part-00006.jsonl.gz',
    '62c33d8b4341c099b8c6332a02f2baa4ff01071d8b397742059caba01a3b604a': '2022__part-00007.jsonl.gz',
    'ef031dd4b3e66f65cf3795d3707b8586e3470c44e5077cf826ae919c6c0625ff': '2022__part-00008.jsonl.gz',
    '6590a1e0b4df533014df37cae7566f4cf899ed8e0677304f1eca3adfaaae1bcb': '2022__part-00009.jsonl.gz',
    '21f184530e269a75697d11e62a1d7c5405bf11ccf72afb7c09145058622a4155': '2022__part-00010.jsonl.gz',
    '6fc97c58da1640140ce2cda260f22e5d5478cd59b43eef1426a6b96f7161b6e3': '2022__part-00011.jsonl.gz',
    'fe38ac9d6bb65984f089862de39b6b60c26ba91bb99460f2f8fb911ea6599d04': '2022__part-00012.jsonl.gz',
    'f8fce4a0036e9d7e030120d5af3087f7912fe41a5686d7756fa92b224e1ee403': '2022__part-00013.jsonl.gz',
    'a808ecd64ef0744cc70ef045113e0ee9d52f54f5fa7248d7b17202f83125727f': '2022__part-00014.jsonl.gz',
    'f77fb1516eae1781f6cd22d0d99ed6937706567e1421c044755aaaa0dc8e456e': '2021__part-00001.jsonl.gz',
    '5657f9105b2cc17595f5d53f669a540955678fe60273ae508a1025ea6a4f128d': '2021__part-00002.jsonl.gz',
    'aa478b838527130e8f07a12aead26efd813bfe9b00a61c928e3b442338843595': '2021__part-00003.jsonl.gz',
    '5d271fdb7091facd351b83ca54c6c0c1b154aed666c709c4fd1a0cc9b15f950e': '2021__part-00004.jsonl.gz',
    '7f082bdc803a2024931cf66e920d1b9ee4b08f6ffe1742e10d0efd26fb140d1c': '2021__part-00005.jsonl.gz',
    '992526a5a522c7f041a6f2fb844205a7cfda58179ff1e979dee962e18f4272df': '2021__part-00006.jsonl.gz',
    '7b4fca607eaa413ec79f653624066f22ff68aeb3d1dc9719376f18c0dc28d0e4': '2021__part-00007.jsonl.gz',
    '8344085ce8d7305f65161a6cd9e758ed99eca4be7618c1f51b4952dfa9b0d76d': '2021__part-00008.jsonl.gz',
    'b7f83a1e32b7305d24311b134c3e937059146dd7b4ba1265aff741bdb2252a10': '2021__part-00009.jsonl.gz',
    '4b963a90baff1b0fb64db64a952354af978f82aa1f13b418c66c741feeab3e68': '2021__part-00010.jsonl.gz',
    '288c49cb6b2b92686298212713aec5aa20a44067ad0062bf85ba04e296128d8d': '2021__part-00011.jsonl.gz',
    '6e263e7c497953ee74c61a3b8a168678fc3739c06df5e5d47a38de4edbf32611': '2021__part-00012.jsonl.gz',
    'b353c14050228083f442435372528cf87a7ba6a0852a2e02b8327a2cc9bffb81': '2020__part-00001.jsonl.gz',
    'c06947a6a3c84d9b91c1e3c3985ff16a9f95a28ab017f71321e06915ce5cbc73': '2020__part-00002.jsonl.gz',
    '1d307554ac60babb546701a682e29afe8accd960f1d061c8fe5a079783fcfa63': '2020__part-00003.jsonl.gz',
    '8417c8cfd7ae423195aa40e595fd2f22115d2c03851cf1ff545df44d99e3af53': '2020__part-00004.jsonl.gz',
    '81923c6e7dbadab2a16baf78947cba18fdc6b5e003ecf3679b194864b4e9e607': '2020__part-00005.jsonl.gz',
    '45b94da1fa9e7f7fa2e42997b38e93bede34284e8a77f40f6579ed82fe5af3ab': '2020__part-00006.jsonl.gz',
    '42dbd320380762127357da3ebadd24c2022bb41eaad1ba89a08c096ba94a6a15': '2020__part-00007.jsonl.gz',
    '7df238f40ea30bb50e01af7647f1de4f39bb36dc3646a3c533a5608d7a512352': '2020__part-00008.jsonl.gz',
    '812b71d3d6148abf4f5dd871f5cf992daec61a9a12a32ca0926126939f46f0ba': '2020__part-00009.jsonl.gz',
    '28b03a0ee8a209e1a6e4a4df56770f1fc6e41bcd46115bd3b234646c04a6bd39': '2020__part-00010.jsonl.gz',
    '59b16babacc3339494d967d7cc1410d04f5b0c7586b0be891a2b16640bdef84b': '2020__part-00011.jsonl.gz',
    'f9631a9a46f938294c65ffea1e3497024fc3975b0991f147e8d1d9e7bbb7efdc': '2020__part-00012.jsonl.gz',
    'b3db363500b000699b76b19d0db9904eba17cd67e963eef67e862f73914a9814': '2020__part-00013.jsonl.gz',
    '5e1ddfa36a2ab20606e00fee4075a43c3b6715fadafade7533561b937b7af2bb': '2019__part-00001.jsonl.gz',
    '3d4958de98ca695ad6bb5684912d1359895bd7a99f0fbd1e5f0cecf1e136763a': '2019__part-00002.jsonl.gz',
    '277bb2343d965f9293cbdd6c53232b1247b504164b4617a980b8a8f1b2e52719': '2019__part-00003.jsonl.gz',
    'b6c28269414d6e23e7aef4f9785e08cdc6ff84a757d4b628ec800069eb2353c0': '2019__part-00004.jsonl.gz',
    'f06ca6f455b4dcc4f5615b252f466bd910ac87f6653f1370edb9da88bd7f630f': '2019__part-00005.jsonl.gz',
    '253e88c8eee59191be0ca44573d59e237b74026802485f8ac99dca6bcd8fff24': '2019__part-00006.jsonl.gz',
    '1e5b0170e9aef27a4e37a04f9e412f085f3d0d530fba2d256ba5bfeaa392bc64': '2019__part-00007.jsonl.gz',
    '9f58f146d7297f17c785f7ee6c863f9d957a6c5d50c01efe32b6f231400d8e46': '2019__part-00008.jsonl.gz',
    '9bdd9c4a27d943947a04287afe6db1938ac30eb6ca5342894e22a87453c7bdb9': '2019__part-00009.jsonl.gz',
    '27acfc8f29329c330e98af97c52a4182ab5d6febdf4a03d2991042fe5d741ba0': '2019__part-00010.jsonl.gz',
    'af019c58a0a28ce2500ae202b81cda8699e4b3b40e4c5c0696068878eee6cf32': '2019__part-00011.jsonl.gz',
    'dae932402e2155ba172b2a373c7cdbb93d897e3ff78ccb485be876fb4ccb84be': '2019__part-00012.jsonl.gz',
    '625e9840163660719317c630520487583ce5a4c79fe3bf6e006e429deae64ebf': '2019__part-00013.jsonl.gz',
    '5be29028e6ef13d0b4db8976a40983a5bf357e62c434bb22889ac129e31c09fe': '2018__part-00001.jsonl.gz',
    '1cdc50cc7117ac806e4c67036c611606cd54555590153980b0229586edef7a53': '2017__part-00001.jsonl.gz',
    '412d8c760f68c52e5c5a1fa4f4d48a9d4ce476a45a2c9ccce2fb37d40f552f2a': '2017__part-00002.jsonl.gz',
    'a46d5df73fdd4ab3437a4abc040026082cc4cb2b44c22495e450551d27ad9847': '2017__part-00003.jsonl.gz',
})
HEADER = ['#', 'Status', 'Batch', 'Batch decision', 'Row decision ID', 'Approver', 'Source key', 'Title', 'Case number', 'Order date', 'Pages',
          'Official PDF URL', 'Document ID', 'Text SHA-256', 'Chunks', 'Job ID', 'Job status', 'Embedding tokens', 'Embedding cost USD',
          'OCR pages', 'Registered at (UTC)', 'Indexed at (UTC)', 'Listing record ID', 'Listing row key', 'Listing origin', 'Listing type',
          'Forum', 'Listing created at (UTC)', 'Source membership', 'Publication status', 'Publication decision', 'Publication approver',
          'Published at (UTC)', 'Review rules SHA-256 (screen.json)', 'Package ID', 'Mapping version', 'Candidates file SHA-256', 'Pack member',
          'Ledger exported at (UTC)']
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
out = []
for i, r in enumerate(ROWS, 1):
    (bdec, rdec, key, title, case, odate, pages, url, doc, tsha, chunks, job, jst, tok, cost, ocr, reg, idx,
     rec, rkey, rtype, forum, rcreated, mem, pst, pdec, pappr, pubat, rules, pkg, mver, fsha) = r
    bkey, b = batch_of(bdec)
    done = jst == 'succeeded' and idx and pst == 'published'
    origin = '' if not rkey else ('new listing created at publication' if str(rkey).startswith('law-order:') else 'existing register listing')
    out.append([i, 'DONE' if done else 'PENDING', b['batch'], bkey, rdec, b['approver'], key, title, case, odate, pages, url, doc, tsha, chunks,
                job, jst, tok, cost, ocr, reg, idx, rec, rkey, origin, rtype, forum, rcreated, mem, pst, pdec, pappr, pubat, rules, pkg, mver, fsha,
                FILEMAP.get(fsha, ''), now])
LEDGER_DIR = '/content/drive/MyDrive/Data Handover/Legal/v1.1/ledger'; os.makedirs(LEDGER_DIR, exist_ok=True)
buf = io.StringIO(); w = csv.writer(buf); w.writerow(HEADER); w.writerows(out)
csv_bytes = buf.getvalue().encode('utf-8')
pathlib.Path(LEDGER_DIR + '/nter-law-ingestion-ledger.csv').write_bytes(csv_bytes)
csv_sha = hashlib.sha256(csv_bytes).hexdigest()
pathlib.Path(LEDGER_DIR + '/nter-law-ingestion-ledger.csv.sha256').write_text(csv_sha + '\n')
summ = {}
for row in out:
    s = summ.setdefault(row[3], {'docs': 0, 'done': 0, 'chunks': 0, 'tokens': 0, 'cost': 0.0})
    s['docs'] += 1; s['done'] += row[1] == 'DONE'; s['chunks'] += int(row[14] or 0); s['tokens'] += int(row[17] or 0); s['cost'] += float(row[18] or 0)
BHEAD = ['Batch', 'Decision', 'Approver', 'Authorized', 'Documents', 'DONE', 'Chunks', 'Embedding tokens', 'Embedding cost USD', 'Decision manifest SHA-256', 'Receipt (repo)']
brows = [[batch_of(k)[1].get('batch', k), k, batch_of(k)[1].get('approver', ''), batch_of(k)[1].get('authorized', ''), v['docs'], v['done'],
          v['chunks'], v['tokens'], round(v['cost'], 8), batch_of(k)[1].get('manifest', ''), batch_of(k)[1].get('receipt', '')] for k, v in summ.items()]
tot = ['TOTAL', '', '', '', sum(v['docs'] for v in summ.values()), sum(v['done'] for v in summ.values()), sum(v['chunks'] for v in summ.values()),
       sum(v['tokens'] for v in summ.values()), round(sum(v['cost'] for v in summ.values()), 8), '', '']
# Google Sheet (owner's Drive, next to the legal pack). One sheet, overwritten in full on each update.
from google.colab import auth; auth.authenticate_user()
import gspread, google.auth
creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'])
gc = gspread.authorize(creds)
ID_FILE = LEDGER_DIR + '/sheet-id.txt'
if os.path.exists(ID_FILE):
    sh = gc.open_by_key(open(ID_FILE).read().strip())
else:
    sh = gc.create('NTER Law ingestion ledger', folder_id='1eGkTBvSyMWx7Ld1R9PB5bbnP-qgt_mQ0')
    pathlib.Path(ID_FILE).write_text(sh.id)
def put(title, header, rows, extra=None):
    try:
        ws = sh.worksheet(title); ws.clear()
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title, rows=max(len(rows) + 10, 100), cols=len(header) + 2)
    ws.resize(rows=max(len(rows) + 10, 100), cols=len(header) + 2)
    ws.update(values=[header] + [[('' if v is None else v) for v in r] for r in rows] + (extra or []), range_name='A1', value_input_option='RAW')
    ws.freeze(rows=1)
    ws.format('1:1', {'textFormat': {'bold': True}})
    return ws
put('Ingested (DONE)', HEADER, out)
put('Batches', BHEAD, brows, [tot, [], ['Ledger CSV', 'Data Handover/Legal/v1.1/ledger/nter-law-ingestion-ledger.csv', 'sha256', csv_sha], ['Exported at (UTC)', now],
                              ['Source', 'read-only SQL over documents, ingest_text_inputs, ingest_jobs, law_publications, law_document_links, law_records, law_source_memberships']])
try:
    sh.del_worksheet(sh.worksheet('Sheet1'))
except Exception:
    pass
print(json.dumps({'sheet_url': sh.url, 'rows': len(out), 'done': sum(r[1] == 'DONE' for r in out), 'csv_sha256': csv_sha, 'batches': brows, 'total': tot}, indent=1, default=str))
