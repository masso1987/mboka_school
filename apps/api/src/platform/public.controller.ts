import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { CommunicationService } from './communication.service';

/** Read before sign-in (Phase 7): maintenance notice, branding and the published legal documents. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicPlatformController {
  constructor(private readonly communication: CommunicationService) {}

  @Get('status')
  status() {
    return this.communication.publicStatus();
  }

  @Get('legal/:kind')
  legal(@Param('kind') kind: string, @Query('locale') locale?: string) {
    return this.communication.publicDocument(kind, locale === 'en' ? 'en' : 'fr');
  }
}
