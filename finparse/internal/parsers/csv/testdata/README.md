# CSV Parser Test Data

This directory contains test data for the PNC CSV parser.

## Purpose

- Store real-world CSV statement files for manual testing and validation
- All files in this directory are automatically ignored by `.gitignore`
- Files should NOT be committed to the repository due to sensitive financial data

## Usage

Place sample PNC CSV files here for testing:

```bash
cp ~/Downloads/pnc-statement.csv finparse/internal/parsers/csv/testdata/
```

Then test with:

```bash
cd finparse
go test -v ./internal/parsers/csv/...
```

## File Format

PNC CSV files should follow this format:

```
AccountNumber,StartDate,EndDate,BeginningBalance,EndingBalance
Date,Amount,Description,Memo,Reference,Type
2024/01/05,-50.00,Coffee Shop,Morning coffee,REF001,DEBIT
2024/01/15,1000.00,Paycheck,Salary deposit,REF002,CREDIT
```

- First row: Summary line with account and period information (5 fields)
- Remaining rows: Transaction data (6 fields each)
- Dates in YYYY/MM/DD format
- Transaction types: DEBIT (negative amounts) or CREDIT (positive amounts)
