import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { ExpensesService } from './expenses.service';
import { FinanceController, PaymentCallbacksController } from './finance.controller';
import { FinanceCore } from './finance-core';
import { PaymentsService } from './payments.service';
import { FinanceReportsService } from './reports.service';
import { FinanceSetupService } from './setup.service';

@Module({
  controllers: [FinanceController, PaymentCallbacksController],
  providers: [FinanceCore, FinanceSetupService, BillingService, PaymentsService, ExpensesService, FinanceReportsService],
})
export class FinanceModule {}
