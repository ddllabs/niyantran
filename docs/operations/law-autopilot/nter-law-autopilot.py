# NTER Law AUTOPILOT: up to 5 consecutive batches of 1,000 IBBI_NCLT orders under one standing approval
# (approver Tamanesh Kauri, 2026-10-26 21:07 IST: "5 batches"). Unattended: a dedicated ingestion account signs in from
# Colab Secrets (NTER_INGEST_EMAIL, NTER_INGEST_PASSWORD, SUPABASE_PUBLISHABLE_KEY) for each tranche; the short-lived
# access token lives only in this process's environment for that tranche and is never printed, saved or logged; the
# refresh token is discarded. Every batch: schema-3 screen -> offline holds (incl. near-duplicate text) -> live presence
# read -> finalize + dry run -> per tranche read-only reconcile then submit -> wait for indexing -> per-document
# verification. Any deviation stops the run (state and reasons in Drive autopilot-status.json); reports are never
# overwritten and every step is resumable after a runtime reset.
import base64, glob, hashlib, http.client, json, os, pathlib, shutil, subprocess, sys, tarfile, time, urllib.error, urllib.parse, urllib.request
from collections import Counter

REPO_SHA = 'cf3e7533209858dadde08274f49fe996dd7179d5'
NODE_TGZ = 'https://registry.npmjs.org/node-linux-x64/-/node-linux-x64-24.22.1.tgz'
NODE_SHA = 'ca7d16d263263ffaa9e8133de2cc138152afb8177f984df31bb255492513d8c8'
LEGAL = '/content/drive/MyDrive/Data Handover/Legal/v1.1'
ZIP = LEGAL + '/file to ingest/NTER_legal_pack_v1.1_FULL_2026-10-18.zip'
ZIP_BYTES = 79418376315
TARGET = 'https://vfgcppstyzjarlzyqdac.supabase.co'
FEATURE = 'NCLT / NCLAT (Insolvency)'
AUTO = 'owner-authorized-20261026-law-auto'
APPROVER = 'Tamanesh Kauri (standing approval for 5 batches, 2026-10-26 21:07 IST)'
BATCHES = [7, 8, 9, 10, 11]
DOCS_PER_BATCH = 1000
MAX_BATCH_CEILING_USD = 2.50
INDEX_TIMEOUT_MIN = 300
ST = pathlib.Path(LEGAL + '/staging/autopilot-20261026')
W = pathlib.Path('/content/nter-law-next100')
REPO = W / 'niyantran'
NODE = W / 'node24' / 'package' / 'bin' / 'node'
ESTIMATOR = (LEGAL + '/nter-law-next100-cell.py', 'd3f62f9e2e2771082180988b14478ca9dd0b283872f597a7b735bdc564453dee')
CORE = ('https://raw.githubusercontent.com/ddllabs/niyantran/{sha}/docs/operations/law-autopilot/nter-law-autopilot-core.py', None)
N1K = LEGAL + '/staging/staging-next1000-20261024-0853/authorized-20261024'
B5 = LEGAL + '/staging/staging-batch5-20261025-2224/authorized-20261026'
B6 = LEGAL + '/staging/staging-batch6-20261026-1100/authorized-20261026'
PRIOR = {  # every completed decision manifest before the autopilot; the screener excludes their keys
    'REPO:docs/operations/law-five-release/decisions.jsonl': '01bdfb8c901c3a63062bd66d7d8b5b0e2f941afbfd480a08fb992d68c566d70b',
    'REPO:docs/operations/law-cohort-2-release/decisions.jsonl': '79760acea597716f6bf295a44479d3ac60d0c8ebf4f1725908bffab8074054ef',
    LEGAL + '/staging/staging-next100-20261023-2204/authorized-20261024/decisions.jsonl': 'af57c78d478048c6c06afba6d76e41ed76ae5f0dd52384200424a2d71920d13b',
    N1K + '/T1/decisions.jsonl': 'ed83e437f7839ab5d9fc8b6094909d4704220a5e77b293d6291a103a4d52f29a',
    N1K + '/T2/decisions.jsonl': '972e95b1a856839e42393206bc9b6a119584944c896d0062edd1783f95fd5506',
    N1K + '/T3/decisions.jsonl': 'dd46363712c898ec9278f4f3f00382cf9555869461dd35b79479094d187f7a9e',
    N1K + '/T4/decisions.jsonl': '5921dce57bfbc840f52af35d38cdd8ed5c7db443d846401089279c5788755354',
    B5 + '/T1/decisions.jsonl': 'aae686d491f3a011599930b763125a780ab38bdd812c76b7bb104efe558bd8c5',
    B5 + '/T2/decisions.jsonl': '295135caa07f82034ecc8b1df401652b5e8b9b80de5c996d81b7f462d7044e0a',
    B5 + '/T3/decisions.jsonl': '8e7a51591f1770e4bdc12bc679d716d2d3f4e3efd1a67c0b6a2a1c50b22466aa',
    B5 + '/T4/decisions.jsonl': '40ce77f897f0fddda882f089c3cfeae82dfee50aa1603b6592ac2b4df33a61c4',
    B5 + '/T5/decisions.jsonl': 'c76eeb95f4d5821b70185fcb84edda8d338e365e60f7c0197e201d63f33356be',
    B6 + '/T1/decisions.jsonl': '146739f44772e2a87b0ced0bd3b235764ac21cd3bd411bfcd1d9c83f47e834dd',
    B6 + '/T2/decisions.jsonl': '2f2b0262982a5bdefe4f211ae01f85d14d34a9df2d733cb17621621ecf05ccf3',
    B6 + '/T3/decisions.jsonl': '59bc3f9963b75c0d84e631c5c2d273725d1a62f5868f0bba882d404a6b70e498',
    B6 + '/T4/decisions.jsonl': '8cfbec56790e42011c62292e72892f0296cb5e526a2bf57c23f8aae7d93237e2',
    B6 + '/T5/decisions.jsonl': '338c70aeb0c2145beef4c620bcca702e2380bfe797519c254e2613030a56771a',
}
# text-native IBBI_NCLT members not yet exhausted, in order (hashes from the archive's CONTENTS.csv; the screener
# re-verifies them against the actual bytes). 2026 and 2025 are exhausted by earlier batches; 2024 p00001 is rescreened
# for any remainder (its earlier selections are excluded by their manifests).
MEMBERS = [
    ('documents/tribunals/IBBI_NCLT/2024__part-00001.jsonl.gz', '9fb17b2c4d338c479cac964ef1cdc193031bb8d3922ecbf22f08a189b3427a7b'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00002.jsonl.gz', 'b4c28d303ec3111affcfe5193859e490cd4a71d023a3a220925b0ab40773e029'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00003.jsonl.gz', '4fbcd56ce9fb77c03340459ba9b5e59590e8bd2e48add34cc890f9876367a26d'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00004.jsonl.gz', '5d92b77b9df16f027966b7503282b4d6a5e91f292f546847f5a05c5a9650f359'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00005.jsonl.gz', '0d696340b8ab893bbe1389d6699da3c8a9b12573367a364c00b4fd8c71c34395'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00006.jsonl.gz', 'c37b595c6ae8a1c5461be1385186eda3c77baddf46de2ebb5a6253911771099d'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00007.jsonl.gz', 'fd842c5bde09db0816f0477c550269068a36fe69364e03f53b838c9300cd831f'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00008.jsonl.gz', 'd3c8f1a776a0dda17fe39ea12737efc90a8e554973dd6946ea19d6dcca4d0ecd'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00009.jsonl.gz', 'c65d651c8a2c4ee40688756fe5c82b29e913daee8173b75c68163bd2211e5d13'),
    ('documents/tribunals/IBBI_NCLT/2024__part-00010.jsonl.gz', 'afd5b32a881ae3ff01e37ebb50aa180ea1cb92dea70b5d32406bc9cc5d4c98ac'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00001.jsonl.gz', '4af0ed9e8fd16db645cfcef5bc522905760224a1e4b83d16908776fff310136d'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00002.jsonl.gz', '857a9a6d0500eb16915c235b4f539e76cc5ad91c88df768de8128f508288c0a6'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00003.jsonl.gz', '48b6ea4d7fcdb5d62986e50a028db10d65310c71f5ba55145f1359f5205bebee'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00004.jsonl.gz', '32dc6c34030ec9425f829bfc759ea6539170b2c8c7f1ea65de08e9a7e4f95b4b'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00005.jsonl.gz', '604b8b110a26bb8fb612da8255ae1c9e87926056a720cf2f230d38adf87717e9'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00006.jsonl.gz', 'c8dc2a5e3f3e855dbef267494f32d435afeb1730f9f3936240238bc6a660795a'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00007.jsonl.gz', 'ad701b4ec87067e74b481506e30016206bf463154de54075e3307a2e8008af98'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00008.jsonl.gz', '3706c86ff249937781489d34cc3e1e30ef213b4e73e61cfe9a33d7d1d50d5f3b'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00009.jsonl.gz', '53b6aa2c4bc6d541c377676e69a2c57f11096d33d6a29a629121eed434a0ca97'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00010.jsonl.gz', '5c2486734b46a07e8bb0c17e29261efd952666c24002e1980fefcd58a38dbc36'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00011.jsonl.gz', 'ddfc62940afd2a77ddc715283006f93553b7d8e33f0b6c3831a45951be1bdc06'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00012.jsonl.gz', 'e66516e99ea770bba55d332b669465fa2b02078dd646f50f463bf34f10d17f25'),
    ('documents/tribunals/IBBI_NCLT/2023__part-00013.jsonl.gz', 'ffc49ef84067a2a92e94462e54bd56808ff54ab5dbbf3c8f5c03bd079c7f93b6'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00001.jsonl.gz', '91d9b66701cebf69015132f4dc140a84faf04869f371a290858f62eab4eb1b63'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00002.jsonl.gz', '3a6c0ef1f5bdbaffb21e0e96cd3066cbf998a915c4e706c594a2bd991bb3e351'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00003.jsonl.gz', '866081206b22258e44489ca42b35bc3d07ac13df773d577c8db6c9200abf0253'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00004.jsonl.gz', '656321310fe1c45c1a521e963c652463464c9e8343aa03fc18d912fe4b9e3024'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00005.jsonl.gz', '0fe0fef9a963d392d4f9216c35693524ced8eda778d2d25a919c935af90bc803'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00006.jsonl.gz', '4c2c39404f3491c46ac11f8fb4ae3e88bcaf199d4e0aad9980730bb042ca2a44'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00007.jsonl.gz', 'b4e50e52f2ddc5eb0200182c67b4fa9010b0ea659ac2c1c21a9981cb3609022b'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00008.jsonl.gz', '39b8879543b23ef47d746ecb9bed1f8c3e70d0a56ac56c1ca52c947f911b29d7'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00009.jsonl.gz', 'f89d76861a04e8c6271f836a8ffb06a31798e7ff562086784c28838d961fa62e'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00010.jsonl.gz', '5a46840391e5bfe1350bad0571fa764e5f4d8c19fe9d1dac603d18e56ceef6be'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00011.jsonl.gz', 'f9bcfba7183a0bd37a13ace972224c3aadf99d1f61f8dc61c09641258f32c0d9'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00012.jsonl.gz', 'f5b697ac72ddc3c4c68b3d2045593db3c4ccb957537da7e2f25f04c3f5eca502'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00013.jsonl.gz', '93a0dfffafeaca1646522424093054b9963edcc6434abac7404c58b867bbadf8'),
    ('documents/tribunals/IBBI_NCLT/2022__part-00014.jsonl.gz', 'e8ad007a667eb808bfc236a45eb4b2ad26ef502f9a100ddd3eeab9d9a17da830'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00001.jsonl.gz', 'a2ffd9998ddafbb16355a7ffc08bcfacd2682dfd0221f3a218caac9f62192f7c'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00002.jsonl.gz', 'd1d8be917141ce15e81fe16ff9739e3faaf22056fc3ce119721271c710d260ec'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00003.jsonl.gz', '099f1728f14dd2d343597d80f4002f16714b44ef557a701f8f2303be4fa7bc99'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00004.jsonl.gz', '8cb2b4ddfb35eb2662a96dad9cac4615b8da6b14e928b67fb2f894c64d4e1ca1'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00005.jsonl.gz', '9021b4e33aa19d97178b7e09133883d00caf1f6b3099b08abd749817b05445a7'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00006.jsonl.gz', '0e64566efd370e33188e2f7ea0ed5bdf19ce7f505b1837b7507be14eddf52e3b'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00007.jsonl.gz', '2f3f7955b1648ab261e743762fcc5f9d4f05c1e86da73b451aa1dc9a5476d5db'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00008.jsonl.gz', 'b093a09ad6c0b260323afdab18d26100e3f9f3fc703eb6bf10f11612f6c06019'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00009.jsonl.gz', '16e9611892ef0142d25681aeff5a2458b3403167e39b54805ed624d0025f5e26'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00010.jsonl.gz', '5d281e4d1ea78d8d6091b02e0871efcfe2506ddd58520abfb3b651be5fe54bb5'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00011.jsonl.gz', '467fb9572201dc5e889b44c350dc0ba54b13349f5c288da066677f63340da8d2'),
    ('documents/tribunals/IBBI_NCLT/2021__part-00012.jsonl.gz', 'fdd4afc80aa700a13a262d5a05ed8d2017cd594fff891b5b26e3adba67060155'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00001.jsonl.gz', '9db61acc1b174d217bde45180e70d19fafa7795f907b0245bbc4a7b39ab058de'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00002.jsonl.gz', '279a801e867bfd016a4e5b986004e1575182904ec78838ca3a334e5d05880bd6'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00003.jsonl.gz', '7b0341510ecbdf4c337ccec2aed0c92a82205694022b9d12ec039910e5307866'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00004.jsonl.gz', '380dd87b33571e284fc92f3b551f475c1225c28ea44f727453ee3c4c46b317a6'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00005.jsonl.gz', '67f5872e4cbe722dd7b4b56d3f700f9f4d97207fb297dd61ab8cff1f1cbfa09c'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00006.jsonl.gz', '8c56761c9028dd8d3932987113e5fabc4a25eb1a9227ea29a5b34e5721888144'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00007.jsonl.gz', 'bf337ee14e84b50a1eb8af1bc969e8db0307caac13fc62fb4002fb31755f9c89'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00008.jsonl.gz', 'd55b344267c0e2eacb3300f51bd2845a10e8ac04c0b77582a433a9ec37cb1a67'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00009.jsonl.gz', '4d3b9e9f9c2c0c62a10b4ddb215a329fd4289e5d6ffca9bae4c7b00f0e9ac078'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00010.jsonl.gz', 'ebb58bf4fc3d89413c68956db1ad10167e2c435347b0d22c4341d342670118e4'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00011.jsonl.gz', '37e457b4fed96b472c72387efa10fc3ae490d7fc4e36487a06db22bada5f2858'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00012.jsonl.gz', '85aef30e0d7ec9267116c6f4138a86c2bc0ed5c7e25181a3d4a79a49858072e4'),
    ('documents/tribunals/IBBI_NCLT/2020__part-00013.jsonl.gz', 'e71ef14b953a8f8e1a90b0a8e66028f510b2ad469b9771ffd8f44cca96569b6a'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00001.jsonl.gz', '7f95ab759d521f6bdd65474291e10a2eaea9a924c459c5a24f34eb12d2808538'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00002.jsonl.gz', '08e51b37f9b4d6365bce1f534a334afc1de57f3adaf89325346466c4371baea1'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00003.jsonl.gz', '3172ac08d4cd21cd85b27fc4d7bfae611230d593a3bfabe6a9055321716d48b7'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00004.jsonl.gz', '3e3d36272ee713d39b6bc76d619de594b78397944aae3f649dfb38524ccac62a'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00005.jsonl.gz', '0c261f74b9813fc90698d028cdabea4a8bce47c14e63aa2f4a70ab29b6f2555d'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00006.jsonl.gz', '764aede5322d12a17193d0d495256aa736edff08fbcd2a4b9fa600a1bbb8694d'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00007.jsonl.gz', '99996697e5aa099b7f8827904b1727a0533dad61d15f4db0504de61983f4b85d'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00008.jsonl.gz', 'be7ac01a3019d548cf5f63e4c2196a13ca627cf131d28af71e2ac3133e09eb85'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00009.jsonl.gz', 'b20630cecc1fab844d100210697ba9ee577158db3ea201ef1e4d4e026515315e'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00010.jsonl.gz', '0c35c486610658d88e49215339a73205a645ee6bc1bbfd3a49779093862665a3'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00011.jsonl.gz', '365bba45f9c33a7a8d29e67fb63bba98d61d607b658f591cec80421473bd1ee2'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00012.jsonl.gz', 'a00e363f4c463207fc4c4412e6ab73b6fbb3e7e2f28154e20af2afde59eacc85'),
    ('documents/tribunals/IBBI_NCLT/2019__part-00013.jsonl.gz', '007eb7083f7954c1465adbdeba7049c93e78919ab3fae91b520488261d19e800'),
    ('documents/tribunals/IBBI_NCLT/2018__part-00001.jsonl.gz', '764bd8c12f9cb7975d501df1bdfb624bf4d7e63561216906cc34620df9c7cf09'),
    ('documents/tribunals/IBBI_NCLT/2017__part-00001.jsonl.gz', 'd635fbacecae3c5a50e00b9df5870170458f6f6b1ffb82930f9098a89b0bb68e'),
    ('documents/tribunals/IBBI_NCLT/2017__part-00002.jsonl.gz', '308d3159b9869dda23f5ba5ed16c313ac8330822c77e542124ea07d1e59343f3'),
    ('documents/tribunals/IBBI_NCLT/2017__part-00003.jsonl.gz', '00fcb87f71bbc6795a0956e7b5545aa3b0809f35ad9771bc1fba47881e9c7ac2'),
]


class Stop(Exception):
    pass


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def run(cmd, env=None):
    r = subprocess.run([str(c) for c in cmd], cwd=REPO, capture_output=True, text=True, env=env)
    if r.returncode:
        raise Stop(f'step failed (exit {r.returncode}): {" ".join(str(c) for c in cmd)[:160]} :: {r.stderr[-600:]}')
    return r.stdout


def write_json(p, obj):
    p = pathlib.Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + '.tmp'); tmp.write_text(json.dumps(obj, indent=1, default=str)); tmp.replace(p)


def status(**kw):
    s = load_state()
    s.setdefault('log', []).append({'at': now(), **kw})
    s['log'] = s['log'][-400:]
    s['last'] = {'at': now(), **kw}
    save_state(s)
    print(json.dumps({'at': now(), **kw}, default=str)[:900], flush=True)


def load_state():
    p = ST / 'autopilot-status.json'
    return json.loads(p.read_text()) if p.exists() else {'started_at': now(), 'approver': APPROVER, 'batches': {}, 'manifests': {}}


def save_state(s):
    write_json(ST / 'autopilot-status.json', s)


# ─── setup ──────────────────────────────────────────────────────────────────
C = None


def setup(core_url, core_sha):
    global C
    if not os.path.exists('/content/drive/MyDrive'):
        from google.colab import drive; drive.mount('/content/drive')
    assert os.path.getsize(ZIP) == ZIP_BYTES, 'legal pack size changed'
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
    assert sha(ESTIMATOR[0]) == ESTIMATOR[1], 'estimator source changed'
    g = {'__name__': 'nter_next100_cell'}
    exec(compile(open(ESTIMATOR[0], 'rb').read(), 'nter-law-next100-cell.py', 'exec'), g)
    (REPO / 'next100-estimate.mjs').write_text(g['ESTIMATE_MJS'], 'utf-8')
    b = urllib.request.urlopen(core_url, timeout=120).read()
    assert hashlib.sha256(b).hexdigest() == core_sha, 'autopilot core hash mismatch'
    m = {'__name__': 'nter_autopilot_core'}
    exec(compile(b, 'nter-law-autopilot-core.py', 'exec'), m)
    C = type('Core', (), m)
    ST.mkdir(parents=True, exist_ok=True)
    load_secrets()


def manifests():
    """Prior manifests (pinned) + every autopilot manifest recorded in the state (pinned at creation)."""
    out = {}
    for p, want in list(PRIOR.items()) + list(load_state()['manifests'].items()):
        path = str(REPO / p[5:]) if p.startswith('REPO:') else p
        assert sha(path) == want, f'manifest changed: {path}'
        out[path] = want
    return out


# ─── credentials (Colab Secrets; nothing typed, printed or stored) ─────────
_SECRETS = {}


def load_secrets():
    """Read the three Colab Secrets once, while the notebook tab is connected (userdata.get talks to the browser and
    must not be called during an unattended run). They stay in this process's memory only."""
    from google.colab import userdata
    try:
        vals = {k: userdata.get(k) for k in ('SUPABASE_PUBLISHABLE_KEY', 'NTER_INGEST_EMAIL', 'NTER_INGEST_PASSWORD')}
    except Exception as e:
        raise Stop(f'Colab Secrets not readable ({type(e).__name__}); add them and enable notebook access')
    key = vals['SUPABASE_PUBLISHABLE_KEY'] or ''
    role = None
    if key.count('.') == 2:
        try:
            p = key.split('.')[1]; role = json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4))).get('role')
        except Exception:
            role = 'unreadable'
    if not (key.startswith('sb_publishable_') or role == 'anon'):
        raise Stop('SUPABASE_PUBLISHABLE_KEY must be the publishable (anon) key, never a secret or service key')
    if not vals['NTER_INGEST_EMAIL'] or not vals['NTER_INGEST_PASSWORD']:
        raise Stop('NTER_INGEST_EMAIL / NTER_INGEST_PASSWORD secrets are empty')
    _SECRETS.clear(); _SECRETS.update(vals)


def sign_in():
    key = _SECRETS['SUPABASE_PUBLISHABLE_KEY']
    req = urllib.request.Request(TARGET + '/auth/v1/token?grant_type=password', method='POST',
                                 data=json.dumps({'email': _SECRETS['NTER_INGEST_EMAIL'], 'password': _SECRETS['NTER_INGEST_PASSWORD']}).encode(),
                                 headers={'apikey': key, 'Content-Type': 'application/json'})
    body = None
    for attempt in range(4):
        try:
            body = json.loads(urllib.request.urlopen(req, timeout=60).read()); break
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 3:
                raise Stop(f'ingestion account sign-in failed: HTTP {e.code}')
        except (urllib.error.URLError, http.client.HTTPException, OSError, json.JSONDecodeError) as e:
            if attempt == 3:
                raise Stop(f'ingestion account sign-in failed: {type(e).__name__}')
        time.sleep(15 * (attempt + 1))
    tok = body.get('access_token')
    if not tok or tok.count('.') != 2:
        raise Stop('sign-in returned no access token')
    os.environ['NTER_INGEST_ACCESS_TOKEN'] = tok
    os.environ['SUPABASE_PUBLISHABLE_KEY'] = key
    body.clear()  # the refresh token is discarded with the response


def forget_creds():
    for k in ('NTER_INGEST_ACCESS_TOKEN', 'SUPABASE_PUBLISHABLE_KEY'):
        os.environ.pop(k, None)


def token_minutes_left():
    try:
        p = os.environ['NTER_INGEST_ACCESS_TOKEN'].split('.')[1]
        return round((json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))['exp'] - time.time()) / 60, 1)
    except Exception:
        return None


def rest_get(path):
    req = urllib.request.Request(TARGET + path, headers={'apikey': os.environ['SUPABASE_PUBLISHABLE_KEY'],
                                                         'Authorization': 'Bearer ' + os.environ['NTER_INGEST_ACCESS_TOKEN']})
    for attempt in range(5):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 4:
                raise Stop(f'read {path.split("?")[0]} failed: HTTP {e.code}')
        except (urllib.error.URLError, http.client.HTTPException, OSError, json.JSONDecodeError) as e:
            if attempt == 4:
                raise Stop(f'read {path.split("?")[0]} failed: {type(e).__name__}')
        time.sleep(15 * (attempt + 1))


def db_law_docs():
    rows = C.rest_pages(rest_get, 'documents', {'select': 'id,source_key,file_url,indexed_at,content_sha256',
                                                 'source_key': 'like.law:*', 'order': 'source_key'})
    return {r['source_key']: r for r in rows}


# ─── registry of ingested documents (for near-duplicate and same-case holds) ─
def registry(db):
    """MinHash signatures and citation of every ingested Law document, read from the live database (documents.ocr_text is
    the exact supplied text, content_sha256 = sha256(ocr_text)); cached in the private staging so each document is read once.
    Needs a signed-in session."""
    import numpy as np
    cache_meta, cache_sig = ST / 'registry-meta.json', ST / 'registry-sigs.npy'
    meta, sigs = [], np.zeros((0, C.NPERM), dtype=np.uint64)
    if cache_meta.exists() and cache_sig.exists():
        try:
            meta = json.loads(cache_meta.read_text()); sigs = np.load(cache_sig)
            assert len(meta) == len(sigs) and sigs.shape[1:] == (C.NPERM,)
        except Exception:
            meta, sigs = [], np.zeros((0, C.NPERM), dtype=np.uint64)  # damaged cache: rebuild from the database
    have = {m['key'] for m in meta}
    need = sorted(set(db) - have)
    for i in range(0, len(need), 25):
        rows = rest_get('/rest/v1/documents?' + urllib.parse.urlencode(
            {'select': 'source_key,file_url,content_sha256,ocr_text,metadata->citation', 'source_key': C.in_filter(need[i:i + 25])},
            safe='(),.*:>-'))
        add_m, add_s = [], []
        for r in rows:
            text = r.get('ocr_text') or ''
            if hashlib.sha256(text.encode('utf-8')).hexdigest() != r.get('content_sha256'):
                raise Stop(f"stored text hash mismatch for {r['source_key'][-16:]}")
            cit = r.get('citation') or {}
            sh = C.shingles(text)
            add_m.append({'key': r['source_key'], 'case': (cit.get('case_number') or '').strip(), 'date': cit.get('order_date') or '',
                          'tail': C.url_tail(r.get('file_url')), 'n': int(len(sh))})
            add_s.append(C.minhash(sh))
        if add_m:
            meta += add_m
            sigs = np.vstack([sigs] + [x[None, :] for x in add_s]) if len(sigs) else np.vstack([x[None, :] for x in add_s])
        if (i // 25) % 20 == 19 or i + 25 >= len(need):
            with open(str(cache_sig) + '.tmp', 'wb') as fh:
                np.save(fh, sigs)
            pathlib.Path(str(cache_meta) + '.tmp').write_text(json.dumps(meta))
            os.replace(str(cache_sig) + '.tmp', cache_sig); os.replace(str(cache_meta) + '.tmp', cache_meta)
    missing = sorted(set(db) - {m['key'] for m in meta})
    return {'sigs': sigs, 'ns': np.array([m['n'] for m in meta]), 'meta': meta}, missing


# ─── screening and selection ───────────────────────────────────────────────
def screen(member, msha, bdir, excl):
    name = pathlib.Path(member).name.split('.')[0]
    out = bdir / 'screens' / f'screen-{name}'
    if not all((out / f).exists() for f in ('screen.json', 'candidates.jsonl', 'estimate-UNSIGNED.json')):
        local = W / 'auto-screens' / bdir.name / out.name
        if local.exists():
            shutil.rmtree(local)
        local.parent.mkdir(parents=True, exist_ok=True)
        cmd = [sys.executable, '-I', 'scripts/law-cohort-screen.py', 'screen', '--archive', ZIP, '--member', member,
               '--expect-member-sha256', msha, '--start-line', '1', '--count', '5000', '--max-scan', '5000', '--feature', FEATURE,
               '--expect-policy-hashes', 'docs/operations/law-five-release/eligibility-evidence.json', '--output-dir', local]
        for x in excl:
            cmd += ['--exclude-decisions', x]
        run(cmd)
        run([NODE, '--experimental-strip-types', 'next100-estimate.mjs', local / 'screen.json', local / 'estimate-UNSIGNED.json'])
        tmp = out.with_name(out.name + '.tmp')
        for d in (tmp, out):
            if d.exists():
                shutil.rmtree(d)
        shutil.copytree(local, tmp)
        tmp.rename(out)
    s = json.loads((out / 'screen.json').read_text('utf-8'))
    if not s.get('finalizable'):
        raise Stop(f'{name}: screen not finalizable')
    if s['lines_scanned'] >= 5000:
        raise Stop(f'{name}: member has 5,000+ lines; the screen window would truncate it')
    assert sha(out / 'candidates.jsonl') == s['candidates_jsonl_sha256']
    est = {r['source_key']: r for r in json.loads((out / 'estimate-UNSIGNED.json').read_text('utf-8'))['rows']}
    texts = {}
    for line in open(out / 'candidates.jsonl', encoding='utf-8'):
        if line.strip():
            r = json.loads(line); texts[r['source_key']] = r.get('text') or ''
    rows = []
    for c in s['candidates']:
        if c['disposition'] != 'ready_for_review':
            continue
        e = est.get(c['source_key'], {}); cit = e.get('citation') or {}
        rows.append({'source_key': c['source_key'], 'member': name, 'line': c['line'], 'file_url': c.get('file_url') or '',
                     'text_sha256': c['text_sha256'], 'n_pages': c.get('n_pages'), 'case_number': (cit.get('case_number') or '').strip(),
                     'order_date': cit.get('order_date') or '', 'est_status': e.get('status'), 'chunks': e.get('chunks'),
                     'content_chars': e.get('content_chars'), 'embedding_input_bytes': e.get('embedding_input_bytes'),
                     'cost_ceiling_usd': e.get('cost_ceiling_usd'), 'text': texts.get(c['source_key'], '')})
    return {'member': name, 'dir': str(out), 'screen_sha256': sha(out / 'screen.json'), 'candidates_jsonl_sha256': s['candidates_jsonl_sha256'],
            'lines': s['lines_scanned'], 'counts': s['counts'], 'held_reasons': s['held_reasons'], 'rows': rows}


def select(n, db, reg):
    """Screen members from the cursor until DOCS_PER_BATCH eligible documents are found; apply every hold."""
    import numpy as np
    bdir = ST / f'b{n:02d}'
    state = load_state()
    cursor = state.get('cursor', 0)
    excl = list(manifests())
    db_keys, db_urls = set(db), {r['file_url'] for r in db.values()}
    db_cd = {C.norm_case(m['case']) + '|' + m['date'] for m in reg['meta'] if m['case'] and m['date']}
    screens, elig, holds, seen, seen_cd = [], [], Counter(), set(), set(db_cd)
    batch_reg = {'sigs': np.zeros((0, C.NPERM), dtype=np.uint64), 'ns': np.array([]), 'meta': [], 'sh': []}
    db_sh = {}

    def db_shingles(i):  # exact text of an ingested document, read on demand for a near-duplicate candidate pair
        key = reg['meta'][i]['key']
        if key not in db_sh:
            sign_in()
            try:
                rows = rest_get('/rest/v1/documents?' + urllib.parse.urlencode(
                    {'select': 'source_key,content_sha256,ocr_text', 'source_key': 'eq.' + key}))
            finally:
                forget_creds()
            t = (rows[0].get('ocr_text') or '') if rows else ''
            if not rows or hashlib.sha256(t.encode('utf-8')).hexdigest() != rows[0].get('content_sha256'):
                raise Stop(f'could not read the stored text of {key[-16:]}')
            db_sh[key] = C.shingles(t)
        return db_sh[key]

    i = cursor
    while len(elig) < DOCS_PER_BATCH and i < len(MEMBERS):
        member, msha = MEMBERS[i]
        sc = screen(member, msha, bdir, excl)
        screens.append({k: v for k, v in sc.items() if k != 'rows'} | {'ready': len(sc['rows'])})
        for r in sc['rows']:
            if r['source_key'] in seen:
                holds['cross-screen duplicate key'] += 1; continue
            seen.add(r['source_key'])
            reasons = C.base_holds(r, db_keys, db_urls)
            # the first document of a (normalized case number, order date) pair is kept; later ones are held
            g = C.norm_case(r['case_number']) + '|' + r['order_date'] if r['case_number'] and r['order_date'] else None
            if g and g in seen_cd:
                reasons.append('possible duplicate order (same case number and order date)')
            if g:
                seen_cd.add(g)
            sh = C.shingles(r.pop('text')); sig = C.minhash(sh)
            if not reasons:
                hit = (C.similar_hold(r, sh, sig, reg, db_shingles)
                       or C.similar_hold(r, sh, sig, batch_reg, lambda j: batch_reg['sh'][j]))
                if hit:
                    reasons.append('near-duplicate text of ' + hit['key'][-16:] + f" (containment {hit['containment']})")
            r['hold_reasons'] = reasons
            if reasons:
                for x in reasons:
                    holds['near-duplicate text' if x.startswith('near-duplicate') else x] += 1
            else:
                if len(elig) < DOCS_PER_BATCH:
                    elig.append(r)
                # later candidates are compared against earlier eligible ones in this window
                C.reg_add(batch_reg, r['source_key'], r['case_number'], r['order_date'], r['file_url'], sig, len(sh), sh)
        i += 1
    if not elig:
        raise Stop('pack exhausted: no eligible documents remain')
    # the next batch restarts at the member holding the last selected document (its selections are then excluded)
    next_cursor = MEMBERS.index(next(m for m in MEMBERS if pathlib.Path(m[0]).name.split('.')[0] == elig[-1]['member']))
    if len(elig) < DOCS_PER_BATCH:
        next_cursor = len(MEMBERS)
    return {'screens': screens, 'eligible': elig, 'holds': dict(holds), 'cursor_start': cursor, 'next_cursor': next_cursor,
            'members_screened': [s['member'] for s in screens]}


# ─── plan, manifests and dry run ───────────────────────────────────────────
def plan(n, sel):
    bdir = ST / f'b{n:02d}'
    tr = C.plan_tranches(sel['eligible'])
    T = {}
    for i, rows in enumerate(tr, 1):
        t = f'T{i}'
        for r in rows:
            r['tranche'] = t
        T[t] = {'members': list(dict.fromkeys(r['member'] for r in rows)), 'docs': len(rows), 'chunks': sum(r['chunks'] for r in rows),
                'cost_ceiling': round(sum(r['cost_ceiling_usd'] for r in rows), 6), 'keys': [r['source_key'] for r in rows]}
    total = round(sum(v['cost_ceiling'] for v in T.values()), 6)
    if total > MAX_BATCH_CEILING_USD:
        raise Stop(f'batch {n}: conservative ceiling ${total} exceeds ${MAX_BATCH_CEILING_USD}')
    rows = sel['eligible']
    tsv = ['\t'.join(['n', 'tranche', 'source_key', 'member_line', 'case_number', 'order_date', 'pages', 'chunks_estimate', 'content_chars',
                      'embedding_input_bytes', 'text_sha256'])]
    for i, r in enumerate(rows, 1):
        tsv.append('\t'.join(str(x) for x in [i, r['tranche'], r['source_key'], f"{r['member']}:{r['line']}", r['case_number'].replace('\t', ' '),
                                                r['order_date'], r['n_pages'], r['chunks'], r['content_chars'], r['embedding_input_bytes'], r['text_sha256']]))
    (bdir / f'cohort-b{n:02d}-UNSIGNED.tsv').write_text('\n'.join(tsv) + '\n')
    fp = hashlib.sha256('\n'.join(sorted(f"{r['source_key']}|{r['chunks']}|{r['text_sha256']}" for r in rows)).encode()).hexdigest()
    p = {'batch': n, 'decision': f'{AUTO}-b{n:02d}', 'approver': APPROVER, 'tranches': T, 'docs': len(rows),
         'chunks': sum(r['chunks'] for r in rows), 'cost_ceiling_usd': total, 'fingerprint_sorted_key_chunks_text': fp,
         'holds': sel['holds'], 'screens': sel['screens'], 'members_screened': sel['members_screened'],
         'cursor_start': sel['cursor_start'], 'next_cursor': sel['next_cursor'],
         'plan_rows': {r['source_key']: {'chunks': r['chunks'], 'text_sha256': r['text_sha256'], 'url': r['file_url'], 'member': r['member']} for r in rows}}
    write_json(bdir / 'plan.json', p)
    return p


def screen_dirs(n):
    return {pathlib.Path(d).name[len('screen-'):]: d for d in glob.glob(str(ST / f'b{n:02d}' / 'screens' / 'screen-*'))}


def finalize(n, P, t):
    d = ST / f'b{n:02d}' / t
    man = d / 'decisions.jsonl'
    if man.exists():
        keys = [json.loads(l)['source_key'] for l in man.read_text().splitlines() if l.strip()]
        if sorted(keys) != sorted(P['tranches'][t]['keys']):
            raise Stop(f'batch {n} {t}: existing manifest does not hold the planned keys')
        s = load_state()
        if s['manifests'].setdefault(str(man), sha(man)) != sha(man):
            raise Stop(f'batch {n} {t}: manifest changed since it was recorded')
        save_state(s)
        return man
    d.mkdir(parents=True, exist_ok=True)
    dirs, parts = screen_dirs(n), []
    for m in P['tranches'][t]['members']:
        keys = [k for k in P['tranches'][t]['keys'] if P['plan_rows'][k]['member'] == m]
        o = d / f'decisions-{m}.jsonl'
        if o.exists():
            o.unlink()
        run([sys.executable, '-I', 'scripts/law-cohort-screen.py', 'finalize', '--screen', dirs[m] + '/screen.json', '--output', o,
             '--decision-id', f"{P['decision']}-{t.lower()}-{m[:4]}p{m[-5:]}", '--approved-by', APPROVER, '--keys', *keys])
        parts.append(o.read_bytes())
    body = b''.join(parts)
    rows = [json.loads(l) for l in body.decode().splitlines()]
    assert len(rows) == P['tranches'][t]['docs'] and len({r['source_key'] for r in rows}) == len(rows)
    with open(man, 'xb') as fh:
        fh.write(body)
    s = load_state(); s['manifests'][str(man)] = sha(man); save_state(s)
    return man


def importer(n, P, t, report, *extra):
    if os.path.exists(report):
        raise Stop(f'{report} exists; reports are never overwritten')
    dirs, corpus = screen_dirs(n), []
    for m in P['tranches'][t]['members']:
        corpus += ['--corpus', dirs[m] + '/candidates.jsonl']
    r = subprocess.run([str(NODE), '--experimental-strip-types', 'scripts/corpus-text-import.mjs', *corpus,
                        '--decisions', str(ST / f'b{n:02d}' / t / 'decisions.jsonl'), '--report', str(report), '--target', TARGET, *extra],
                       cwd=REPO, capture_output=True, text=True, env=os.environ)
    rows = [json.loads(l) for l in open(report)] if os.path.exists(report) else []
    if r.returncode not in (0, 2):
        status(batch=n, tranche=t, event='importer error', exit=r.returncode, stderr=r.stderr[-400:])
    return r.returncode, rows


def dry_runs(n, P):
    for t, v in P['tranches'].items():
        man = finalize(n, P, t)
        rpt = ST / f'b{n:02d}' / t / 'dry-run.jsonl'
        rows = [json.loads(l) for l in open(rpt)] if rpt.exists() else importer(n, P, t, rpt)[1]
        s = rows[-1] if rows else {}
        per_doc = {x['source_key']: x.get('chunks') for x in rows if x.get('source_key')}
        off = [k[-16:] for k in v['keys'] if per_doc.get(k) != P['plan_rows'][k]['chunks']]
        if off:
            raise Stop(f'batch {n} {t}: dry-run chunk count differs from the estimate for {len(off)} documents')
        if not (s.get('ready') == v['docs'] and s.get('held') == 0 and s.get('chunks') == v['chunks']
                and s.get('estimated_cost_ceiling_usd', 9) <= C.max_cost(v['cost_ceiling'])):
            raise Stop(f'batch {n} {t}: dry run differs (ready {s.get("ready")}/{v["docs"]}, held {s.get("held")}, chunks {s.get("chunks")}/{v["chunks"]})')
        v['manifest_sha256'] = sha(man)
    write_json(ST / f'b{n:02d}' / 'plan.json', P)


# ─── live: reconcile, submit, wait, verify ─────────────────────────────────
def link_ok(url):
    recs = rest_get('/rest/v1/law_records?' + urllib.parse.urlencode({'select': 'id,record_type,forum', 'source_url': 'eq.' + url}))
    if len(recs) != 1 or recs[0].get('record_type') != 'tribunal_order' or recs[0].get('forum') != 'NCLT':
        return False
    return not rest_get('/rest/v1/law_document_links?' + urllib.parse.urlencode({'select': 'document_id', 'record_id': 'eq.' + recs[0]['id']}))


def submit_tranche(n, P, t):
    v, d = P['tranches'][t], ST / f'b{n:02d}' / t
    if glob.glob(str(d / 'submit-*.jsonl')):
        try:
            last = [json.loads(l) for l in open(d / 'submit-1.jsonl') if l.strip()][-1]
        except Exception:
            last = {}
        if (last.get('type') == 'summary' and last.get('submitted') == v['docs'] and last.get('uncertain') == 0
                and last.get('registration_held') == 0 and last.get('held') == 0):
            return
        raise Stop(f'batch {n} {t}: an earlier submission is incomplete or uncertain; reconcile it before resuming')
    sign_in()
    try:
        k = 1
        while (d / f'reconcile-{k}.jsonl').exists():
            k += 1
        code, rows = importer(n, P, t, d / f'reconcile-{k}.jsonl', '--reconcile')
        src = {x['source_key']: x for x in rows if x.get('source_key')}
        bad, actions = [], Counter()
        for key in v['keys']:
            x = src.get(key) or {}; m = x.get('mapping') or {}
            a = m.get('action')
            ok = x.get('status') == 'ready' and m.get('status') == 'ready' and not m.get('document_id') and len(m.get('fingerprint') or '') == 64
            ok = ok and (a == 'create-listing' or (a == 'link-existing' and link_ok(P['plan_rows'][key]['url'])))
            actions[a] += 1
            if not ok:
                bad.append([key[-16:], x.get('status'), m.get('status'), a, m.get('reasons')])
        s = rows[-1] if rows else {}
        rec = {'tranche': t, 'reconcile_exit': code, 'reconcile_sha256': sha(d / f'reconcile-{k}.jsonl') if rows else None, 'summary': s,
               'actions': dict(actions), 'mismatches': bad[:50], 'mismatch_count': len(bad), 'token_minutes_left': token_minutes_left()}
        write_json(d / f'reconcile-{k}-status.json', rec)
        if (code != 0 or bad or s.get('ready') != v['docs'] or s.get('held') != 0 or s.get('chunks') != v['chunks']
                or s.get('manifest_sha256') != v['manifest_sha256']):
            raise Stop(f'batch {n} {t}: live reconcile differs from the plan ({len(bad)} keys); not submitted')
        forget_creds(); sign_in()  # a fresh token for the submission itself
        need = v['docs'] * 5.2 / 60 + 10
        if (token_minutes_left() or 0) < need:
            raise Stop(f'batch {n} {t}: fresh token has {token_minutes_left()} minutes, below the {need:.0f} needed')
        code, rows = importer(n, P, t, d / 'submit-1.jsonl', '--submit', '--approval', v['manifest_sha256'],
                              '--max-chunks', str(v['chunks']), '--max-estimated-cost-usd', str(C.max_cost(v['cost_ceiling'])))
        s = rows[-1] if rows else {}
        res = {'tranche': t, 'submit_exit': code, 'report_sha256': sha(d / 'submit-1.jsonl') if rows else None, 'summary': s,
               'actions': dict(actions)}
        write_json(d / 'submit-1-status.json', res)
        if not (code in (0, 2) and s.get('submitted') == v['docs'] and s.get('uncertain') == 0 and s.get('registration_held') == 0):
            raise Stop(f'batch {n} {t}: submission not clean ({s.get("submitted")}/{v["docs"]}, uncertain {s.get("uncertain")})')
        status(batch=n, tranche=t, event='submitted', docs=v['docs'], chunks=v['chunks'], actions=dict(actions))
    finally:
        forget_creds()


def docs_for(keys):
    out = {}
    for i in range(0, len(keys), 80):
        for r in rest_get('/rest/v1/documents?' + urllib.parse.urlencode(
                {'select': 'id,source_key,indexed_at,content_sha256,file_url', 'source_key': C.in_filter(keys[i:i + 80])}, safe='(),*.:')):
            out[r['source_key']] = r
    return out


def wait_indexed(n, P):
    keys = list(P['plan_rows'])
    t0 = time.time()
    while True:
        sign_in()
        try:
            got = docs_for(keys)
        finally:
            forget_creds()
        done = sum(1 for k in keys if (got.get(k) or {}).get('indexed_at'))
        status(batch=n, event='indexing', indexed=done, of=len(keys))
        if done == len(keys):
            return
        if (time.time() - t0) / 60 > INDEX_TIMEOUT_MIN:
            raise Stop(f'batch {n}: only {done}/{len(keys)} indexed after {INDEX_TIMEOUT_MIN} minutes')
        time.sleep(300)


def verify(n, P):
    keys = list(P['plan_rows'])
    sign_in()
    try:
        got = docs_for(keys)
        ids = {got[k]['id']: k for k in keys if k in got}
        chunks, nullv, links = Counter(), Counter(), Counter()
        idl = list(ids)
        for i in range(0, len(idl), 60):
            f = C.in_filter(idl[i:i + 60])
            for r in C.rest_pages(rest_get, 'document_chunks', {'select': 'id,document_id', 'document_id': f, 'order': 'id'}):
                chunks[r['document_id']] += 1
            for r in C.rest_pages(rest_get, 'document_chunks', {'select': 'id,document_id', 'document_id': f, 'embedding': 'is.null',
                                                                 'order': 'id'}):
                nullv[r['document_id']] += 1
            for r in C.rest_pages(rest_get, 'law_document_links', {'select': 'document_id,record_id', 'document_id': f,
                                                                    'order': 'document_id,record_id'}):
                links[r['document_id']] += 1
    finally:
        forget_creds()
    bad = []
    for k, pr in P['plan_rows'].items():
        g = got.get(k)
        if not g:
            bad.append([k[-16:], 'missing']); continue
        problems = [x for x, ok in [('not indexed', g.get('indexed_at')), ('text hash', g.get('content_sha256') == pr['text_sha256']),
                                     ('chunks', chunks[g['id']] == pr['chunks']), ('null vectors', nullv[g['id']] == 0),
                                     ('listing', links[g['id']] == 1), ('url', g.get('file_url') == pr['url'])] if not ok]
        if problems:
            bad.append([k[-16:], problems])
    fp = hashlib.sha256('\n'.join(sorted(f"{k}|{chunks[got[k]['id']]}|{got[k]['content_sha256']}" for k in keys if k in got)).encode()).hexdigest()
    res = {'batch': n, 'checked_at': now(), 'docs': len(keys), 'found': len(got), 'indexed': sum(1 for k in got if got[k].get('indexed_at')),
           'chunks': sum(chunks.values()), 'null_vectors': sum(nullv.values()), 'one_listing_each': sum(1 for d in ids if links[d] == 1),
           'fingerprint': fp, 'fingerprint_matches_plan': fp == P['fingerprint_sorted_key_chunks_text'], 'problems': bad[:100],
           'problem_count': len(bad)}
    write_json(ST / f'b{n:02d}' / 'verify.json', res)
    return res


# ─── the loop ──────────────────────────────────────────────────────────────
def run_batch(n):
    bdir = ST / f'b{n:02d}'
    bdir.mkdir(parents=True, exist_ok=True)
    st = load_state()
    b = st['batches'].get(str(n), {})
    if b.get('phase') == 'verified':
        return
    if (bdir / 'plan.json').exists():
        P = json.loads((bdir / 'plan.json').read_text())
    else:
        sign_in()
        try:
            db = db_law_docs()
            reg, missing = registry(db)
        finally:
            forget_creds()
        if missing:
            raise Stop(f'{len(missing)} ingested documents could not be read for the duplicate registry')
        status(batch=n, event='registry', law_docs=len(db), registry=len(reg['meta']), without_text=len(missing))
        sel = select(n, db, reg)
        P = plan(n, sel)
        status(batch=n, event='planned', docs=P['docs'], chunks=P['chunks'], ceiling=P['cost_ceiling_usd'], holds=P['holds'],
               members=P['members_screened'])
    if not all(v.get('manifest_sha256') for v in P['tranches'].values()):
        dry_runs(n, P)
        status(batch=n, event='dry run ok', tranches={t: v['docs'] for t, v in P['tranches'].items()})
    for t in P['tranches']:
        submit_tranche(n, P, t)
    s = load_state(); s['batches'][str(n)] = {'phase': 'submitted', 'at': now()}; save_state(s)
    wait_indexed(n, P)
    for attempt in range(6):  # publication (the listing link) follows indexing by a few minutes
        res = verify(n, P)
        if not res['problems'] and res['fingerprint_matches_plan']:
            break
        only_listing = all(isinstance(b[1], list) and b[1] == ['listing'] for b in res['problems'])
        if not only_listing or attempt == 5:
            raise Stop(f"batch {n}: verification failed for {res['problem_count']} documents")
        time.sleep(300)
    s = load_state()
    s['batches'][str(n)] = {'phase': 'verified', 'at': now(), 'docs': res['docs'], 'chunks': res['chunks']}
    s['cursor'] = P['next_cursor']
    save_state(s)
    status(batch=n, event='verified', docs=res['docs'], chunks=res['chunks'])


def run_all(core_url, core_sha):
    setup(core_url, core_sha)
    try:
        for n in BATCHES:
            run_batch(n)
        status(event='finished', batches=BATCHES)
    except Stop as e:
        status(event='STOPPED', reason=str(e))
    except Exception as e:
        status(event='STOPPED (unexpected error)', reason=f'{type(e).__name__}: {e}'[:600])
        raise
    finally:
        forget_creds()
        _SECRETS.clear()
    return load_state()
