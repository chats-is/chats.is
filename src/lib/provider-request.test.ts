import { describe, expect, it } from 'vitest';

import {
  providerRequestOf,
  providerRequestsOf,
  requestTags,
  withRequestTags
} from './provider-request';

describe('providerRequestOf', () => {
  it('reads the response id and the request id each provider sends', () => {
    // As the probes against each provider answered.
    expect(
      providerRequestOf({
        id: 'resp_1',
        headers: { 'x-request-id': 'req_1' }
      })
    ).toEqual({ responseId: 'resp_1', requestId: 'req_1' });
    expect(
      providerRequestOf({ id: 'msg_1', headers: { 'request-id': 'req_2' } })
    ).toEqual({ responseId: 'msg_1', requestId: 'req_2' });
    expect(
      providerRequestOf({ id: 'u-1', headers: { 'x-ds-trace-id': 't-1' } })
    ).toEqual({ responseId: 'u-1', requestId: 't-1' });
  });

  it('keeps what there is: a Gemini response names no request, a media call no response', () => {
    expect(providerRequestOf({ id: 'g-1', headers: {} })).toEqual({
      responseId: 'g-1'
    });
    expect(providerRequestOf({ headers: { 'x-request-id': 'req_3' } })).toEqual(
      { requestId: 'req_3' }
    );
  });

  it('leaves out the id the SDK made up for a provider that sent none', () => {
    expect(providerRequestOf({ id: 'aitxt-abc', headers: {} })).toBeNull();
    expect(providerRequestOf(undefined)).toBeNull();
  });

  it('lists only the calls that had an id', () => {
    expect(
      providerRequestsOf([
        { id: 'resp_1' },
        { id: 'aitxt-x' },
        { headers: { 'x-amzn-requestid': 'b-1' } }
      ])
    ).toEqual([{ responseId: 'resp_1' }, { requestId: 'b-1' }]);
  });
});

describe('requestTags', () => {
  it('names the usage row where the provider has a field for it', () => {
    expect(requestTags('openai', 'usage-1')).toEqual({
      metadata: { usage_id: 'usage-1' }
    });
    expect(requestTags('azure', 'usage-1')).toEqual(
      requestTags('openai', 'usage-1')
    );
    expect(requestTags('vertex', 'usage-1')).toEqual({
      labels: { usage_id: 'usage-1' }
    });
    expect(requestTags('bedrock', 'usage-1')).toEqual({
      requestMetadata: { usage_id: 'usage-1' }
    });
  });

  it('sends nothing where there is no such field', () => {
    for (const type of ['anthropic', 'xai', 'deepseek', 'google'] as const) {
      expect(requestTags(type, 'usage-1')).toEqual({});
    }
  });
});

describe('withRequestTags', () => {
  it('sends the tags alone where the admin set nothing', () => {
    expect(withRequestTags('openai', 'usage-1', null)).toEqual({
      metadata: { usage_id: 'usage-1' }
    });
  });

  it('keeps the admin’s other options as they are', () => {
    expect(withRequestTags('openai', 'usage-1', { store: false })).toEqual({
      metadata: { usage_id: 'usage-1' },
      store: false
    });
  });

  it('keeps the admin’s keys in the record a tag goes in, beside ours', () => {
    expect(
      withRequestTags('openai', 'usage-1', { metadata: { team: 'a' } })
    ).toEqual({ metadata: { team: 'a', usage_id: 'usage-1' } });
    expect(
      withRequestTags('bedrock', 'usage-1', {
        requestMetadata: { project: 'p' }
      })
    ).toEqual({ requestMetadata: { project: 'p', usage_id: 'usage-1' } });
    expect(
      withRequestTags('vertex', 'usage-1', { labels: { env: 'prod' } })
    ).toEqual({ labels: { env: 'prod', usage_id: 'usage-1' } });
  });

  it('keeps our usage_id over one the admin wrote', () => {
    expect(
      withRequestTags('openai', 'usage-1', { metadata: { usage_id: 'x' } })
    ).toEqual({ metadata: { usage_id: 'usage-1' } });
  });

  it('passes the admin’s options through where there is nothing to tag', () => {
    expect(
      withRequestTags('anthropic', 'usage-1', { metadata: { userId: 'u' } })
    ).toEqual({ metadata: { userId: 'u' } });
  });
});
