"""Sequential, isolated transport stress. Not broker-observed fill evidence."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import pytest
from brontide_eod.ibkr_tws import PaperSafetyError
from brontide_eod.paper_domain import summarize
from brontide_eod.paper_service import PaperService
from test_paper_lifecycle import service, ticket, plan


def test_fixed_price_targets_must_be_profitable_and_tick_valid(service):
    for price in [99, 100, 102.001]:
        exits = plan()
        exits['legs'][0]['target'] = {'mode': 'Price', 'price': price}
        with pytest.raises(PaperSafetyError, match='Fixed target'):
            service.prepare_batch([ticket(exitPlan=exits)])
    assert not service.client.writes


def test_200_sequential_campaigns_preserve_identity_fees_and_flat_cleanup(service):
    s = service
    for index in range(200):
        exits = plan()
        # Five supported allocation shapes, including both independent runners.
        if index % 5 == 0:
            exits['legs'] = [dict(exits['legs'][0], allocationPercent=100)]
        elif index % 5 == 1:
            exits['legs'] = [dict(exits['legs'][0], allocationPercent=50),
                             dict(exits['legs'][0], id='T2', allocationPercent=50, target={'mode':'R','multipleR':2})]
        elif index % 5 == 2:
            exits['legs'] = [dict(exits['legs'][0], allocationPercent=50), dict(exits['legs'][1], allocationPercent=50)]
        elif index % 5 == 3:
            exits['legs'][1] = dict(exits['legs'][0], id='T2', target={'mode':'R','multipleR':2})
        quantity = len(exits['legs'])
        s.client.bid, s.client.ask = 99.99, 100
        b = s.prepare_batch([ticket(quantity=quantity, exitPlan=exits)])
        Path(os.environ['BRONTIDE_PAPER_APPROVAL_FILE']).write_text(json.dumps({
            'batchId':b['id'],'ticketDigest':b['digest'],'sourceIdentity':'reviewed-source',
            'accountBinding':s.client.config.binding(),'connectionId':s.connection_id,
            'approvedAt':datetime.now(timezone.utc).isoformat()}))
        s.arm(b['id'])
        command = f'sequence-{index}'
        submitted = s.submit(b['id'],0,command)
        assert submitted['summary']['entered'] == 0  # ACK is not a fill.
        writes = len(s.client.writes)
        assert s.submit(b['id'],0,command)['id'] == submitted['id']
        assert len(s.client.writes) == writes
        c = s.store.all('campaign')[-1]
        for slot in c['slots']: s.client.fill(slot['entry']['orderId'],100)
        s._events()
        if index % 25 == 0:
            # Restart is disarmed and requires exact approval before management.
            restarted = PaperService(s.store, factory=lambda: s.client, source=lambda:'reviewed-source')
            restarted.client = s.client
            restarted.connection_id = s.connection_id
            assert restarted.armed is None
            restarted.arm(b['id'])
            s = restarted
        s.client.bid, s.client.ask = 103,103.01
        s._automate(s.store.all('campaign')[-1]); s._events()
        c = s.store.all('campaign')[-1]
        for slot in c['slots']:
            order = slot.get('exit') or slot['stop']
            price = order['fields'].get('lmtPrice',order['fields'].get('auxPrice'))
            s.client.fill(order['orderId'],price,fee=None if index % 10 == 0 else .1)
        s._events()
        if index % 10 == 0:
            assert summarize(s.store.all('campaign')[-1])['netRealized'] is None
            for event in s.client.fills[-quantity:]:
                s.client.events.append({'kind':'commission','executionId':event['executionId'],'commission':.1,'currency':'USD'})
            s._events()
        s.reconcile()  # Replays all executions; must have no duplicate economic effect.
        c = s.store.all('campaign')[-1]
        assert c['state'] == 'Closed'
        result = summarize(c)
        assert result['entered'] == result['exited'] == quantity
        assert result['fees'] == pytest.approx(quantity * .2)
        assert len(c['executions']) == quantity * 2
        assert not s.client.read_only_snapshot().open_order_rows
        assert not s.client.read_only_snapshot().position_rows
    assert len(s.store.all('campaign')) == 200
    assert len({e['executionId'] for c in s.store.all('campaign') for e in c['executions']}) == 880
    s.shutdown()
