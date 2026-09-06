"""Run the pinned, locally built LEAN launcher without a CLI account or data purchase."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import hashlib

ROOT = Path(__file__).resolve().parents[2]
PILOT = ROOT / 'output/lean-pilot'


def run(evidence, case):
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=PILOT/'Lean',text=True).strip()
    if revision!='23b735d99a357807dc0df9f4c51d30f05fe0d277':raise ValueError('LEAN revision differs from the pinned pilot')
    destination = evidence / ('native-' + case)
    destination.mkdir(exist_ok=True)
    config = {
        'environment': 'backtesting', 'live-mode': False,
        'algorithm-type-name': 'PilotAlgorithm', 'algorithm-language': 'CSharp',
        'algorithm-location': str(PILOT / 'algorithm/PilotAlgorithm.dll'),
        'data-folder': str(PILOT / 'Lean/Data'),
        'results-destination-folder': str(destination),
        'log-handler': 'QuantConnect.Logging.CompositeLogHandler',
        'messaging-handler': 'QuantConnect.Messaging.Messaging',
        'job-queue-handler': 'QuantConnect.Queues.JobQueue',
        'api-handler': 'QuantConnect.Api.Api',
        'map-file-provider': 'QuantConnect.Data.Auxiliary.LocalDiskMapFileProvider',
        'factor-file-provider': 'QuantConnect.Data.Auxiliary.LocalDiskFactorFileProvider',
        'data-provider': 'QuantConnect.Lean.Engine.DataFeeds.DefaultDataProvider',
        'object-store': 'QuantConnect.Lean.Engine.Storage.LocalObjectStore',
        'setup-handler': 'QuantConnect.Lean.Engine.Setup.BacktestingSetupHandler',
        'result-handler': 'QuantConnect.Lean.Engine.Results.BacktestingResultHandler',
        'data-feed-handler': 'QuantConnect.Lean.Engine.DataFeeds.FileSystemDataFeed',
        'real-time-handler': 'QuantConnect.Lean.Engine.RealTime.BacktestingRealTimeHandler',
        'history-provider': ['QuantConnect.Lean.Engine.HistoricalData.SubscriptionDataReaderHistoryProvider'],
        'transaction-handler': 'QuantConnect.Lean.Engine.TransactionHandlers.BacktestingTransactionHandler',
        'job-user-id': '0', 'api-access-token': '', 'job-organization-id': '',
        'close-automatically': True, 'show-missing-data-logs': False,
        'pilot-input': str(evidence / case), 'pilot-output': str(evidence / ('lean-' + case + '.json')),
    }
    path = destination / 'config.json'
    path.write_text(json.dumps(config, indent=2))
    target=Path(config['pilot-output']);previous=target.stat().st_mtime_ns if target.exists() else None
    start = time.perf_counter()
    with (destination / 'launcher.log').open('w') as log:
        process = subprocess.run([str(PILOT / 'dotnet/dotnet.exe'), 'QuantConnect.Lean.Launcher.dll', '--config', str(path)],
                                 cwd=PILOT / 'Lean/Launcher/bin/Release', stdout=log, stderr=subprocess.STDOUT, timeout=180)
    result = {'case': case, 'wall_seconds': time.perf_counter()-start, 'exit_code': process.returncode,
              'output_exists': target.exists() and target.stat().st_mtime_ns!=previous,
              'lean_revision':revision,'algorithm_sha256':hashlib.sha256((ROOT/'scripts/lean-pilot/PilotAlgorithm.cs').read_bytes()).hexdigest()}
    (destination / 'timing.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, default=PILOT / 'evidence')
    parser.add_argument('--case', default='all')
    args = parser.parse_args()
    cases = list(json.loads((args.evidence / 'expected.json').read_text())) if args.case == 'all' else [args.case]
    for case in cases:
        result = run(args.evidence.resolve(), case)
        if result['exit_code'] or not result['output_exists']:
            raise SystemExit('Inspect native-' + case + '/launcher.log')
