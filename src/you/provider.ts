import type { YouAnswerResponse, YouContent, YouResearchResponse, YouSearchResponse } from './types.js';
import type { YouClient } from './client.js';

export interface WebResearchProvider {
  search(query: string): Promise<YouSearchResponse>;
  answer(query: string): Promise<YouAnswerResponse>;
  research(query: string): Promise<YouResearchResponse>;
  getContents(urls: string[]): Promise<YouContent[]>;
}

export class YouProvider implements WebResearchProvider {
  constructor(
    private readonly client: YouClient,
    private readonly searchEnabled = true,
    private readonly researchEnabled = true,
  ) {}
  search(query: string): Promise<YouSearchResponse> {
    if (!this.searchEnabled) return Promise.reject(new Error('You.com Search is disabled.'));
    return this.client.search(query);
  }
  answer(query: string): Promise<YouAnswerResponse> { return this.client.answer(query); }
  research(query: string): Promise<YouResearchResponse> {
    if (!this.researchEnabled) return Promise.reject(new Error('You.com Research is disabled.'));
    return this.client.research(query);
  }
  getContents(urls: string[]): Promise<YouContent[]> { return this.client.getContents(urls); }
}

export class DisabledWebResearchProvider implements WebResearchProvider {
  private unavailable(): Promise<never> { return Promise.reject(new Error('Fresh web research is not configured.')); }
  search(): Promise<YouSearchResponse> { return this.unavailable(); }
  answer(): Promise<YouAnswerResponse> { return this.unavailable(); }
  research(): Promise<YouResearchResponse> { return this.unavailable(); }
  getContents(): Promise<YouContent[]> { return this.unavailable(); }
}
