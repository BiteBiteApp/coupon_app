import unittest
from decimal import Decimal
from price_worksheet_20261017 import worksheet


class CurrentPriceWorksheetTest(unittest.TestCase):
    def test_same_limits_and_no_authorization(self):
        result = worksheet()
        self.assertEqual(result['checkedDate'], '2026-10-17')
        self.assertFalse(result['paidRunAuthorized'])
        self.assertFalse(result['actualAccountPricesAndUsageVerified'])
        self.assertEqual(result['cleanupReserveUsd'], '30.00')
        self.assertEqual(result['planningCeilingUsd'], '300.00')
        self.assertEqual(result['earlyOwnerCheckpointUsd'], '100.00')

    def test_total_includes_retention_and_unpriced_contingencies(self):
        result = worksheet()
        subtotal = sum(Decimal(item['usd']) for item in result['items'])
        subtotal += sum(Decimal(x) for x in result['explicitUnpricedAllowancesUsd'].values())
        self.assertEqual(str((subtotal + 30).quantize(Decimal('.01'))), result['modeledPlusReserveUsd'])
        names = {item['item'] for item in result['items']}
        self.assertTrue({'SQL backups and retained exposure', 'Snapshot possible soft-delete exposure',
                         'Firestore document+index storage', 'Load runner CPU', 'Independent control internal steps'} <= names)

    def test_historical_comparison_is_dated_and_separate(self):
        result = worksheet()
        self.assertEqual(result['historical20261002PlusReserveUsd'], '255.54')
        self.assertEqual(Decimal(result['modeledPlusReserveUsd']) - Decimal('255.54'),
                         Decimal(result['changeFromRoundedHistoricalUsd']))


if __name__ == '__main__':
    unittest.main()
