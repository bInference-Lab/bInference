// Error and status answers of Across's API, recorded live on 2026-11-01 at about 11:30 UTC. Each
// is whole. HTTP 400 for every error, 200 for every status but the last, which is 404.

/** `AMOUNT_TOO_LOW`: 1,000 base units of BSC USDC to Base. */
export const tooLowAnswer: string = `{"type":"AcrossApiError","code":"AMOUNT_TOO_LOW","status":400,"message":"Failed to fetch swap quote: Bridge amount 1000 is too low to cover bridge fees 0","id":"4pfbr-1793528821725-ed3b27fa83a8"}`;

/** `AMOUNT_TOO_HIGH`: 100,000,000 BSC USDC to Base, over the route's liquidity. */
export const tooHighAnswer: string = `{"type":"AcrossApiError","code":"AMOUNT_TOO_HIGH","status":400,"message":"Amount is higher than available liquidity. Max amount is 20001.100060503327683022 USDC-BNB.","id":"zggxz-1793528823020-66ada41d306a"}`;

/**
 * `LOW_BRIDGE_LIQUIDITY`: BSC ETH (0.01) to Robinhood Chain at about 12:07 UTC, an hour after the
 * same route quoted. No error list names the code.
 */
export const lowLiquidityAnswer: string = `{"type":"AcrossApiError","code":"LOW_BRIDGE_LIQUIDITY","status":400,"message":"Amount is higher than available liquidity.","id":"gqmn9-1793531229335-0a83a237ff31"}`;

/** `INVALID_PARAM` on `depositor`: an address that is not one. */
export const badDepositorAnswer: string = `{"type":"AcrossApiError","code":"INVALID_PARAM","status":400,"message":"Invalid parameter at path 'depositor'. Expected type 'union'","param":"depositor","id":"cn8vx-1793528824349-1dbbf1e08086"}`;

/** `INVALID_PARAM` on `amount`: the amount left out. */
export const noAmountAnswer: string = `{"type":"AcrossApiError","code":"INVALID_PARAM","status":400,"message":"Invalid parameter at path 'amount'. Expected type 'positiveIntStr'","param":"amount","id":"bfmwr-1793528825564-06754adee105"}`;

/** `INVALID_PARAM` on `outputToken`: BSC USDC to Solana USDC, which Across does not bridge from BSC. */
export const solanaAnswer: string = `{"type":"AcrossApiError","code":"INVALID_PARAM","status":400,"message":"Destination swaps are not supported yet for routes involving Solana.","param":"outputToken","id":"zggxz-1793528826829-3610bcb4bcc2"}`;

/** `INVALID_PARAM` with no parameter: no bridge route from BSC to Blast, the answer Across gave for every BSC route on 2026-10-30. */
export const noRoutesAnswer: string = `{"type":"AcrossApiError","code":"INVALID_PARAM","status":400,"message":"Failed to fetch swap quote: No bridge routes found for 56 -> 81457","id":"nd2n6-1793528845190-a5c621625b57"}`;

/** `INVALID_PARAM` on `destinationChainId`: a chain Across does not know. */
export const unsupportedChainAnswer: string = `{"type":"AcrossApiError","code":"INVALID_PARAM","status":400,"message":"Unsupported chain id: 56","param":"destinationChainId","id":"h62nq-1793528830458-fd316130680e"}`;

/** `ROUTE_NOT_ENABLED` from `GET /limits` for BSC USDC to Blast. */
export const notEnabledAnswer: string = `{"type":"AcrossApiError","code":"ROUTE_NOT_ENABLED","status":400,"message":"Route is not enabled."}`;

/** `GET /deposit/status`: a BSC ETH deposit to Base, filled. */
export const filledAnswer: string = `{"sweepTxnRef":null,"actionsTargetRecipient":null,"actionsTargetToken":null,"actionsTargetAmount":null,"actionsTargetTxnRef":null,"actionsTargetBlockTimestamp":null,"status":"filled","originChainId":56,"depositId":"1271723","depositTxHash":"0x84e24fa961f7b9c2d40b5e9a18fe34888a9541e857797192bfc0f2611be469bb","depositTxnRef":"0x84e24fa961f7b9c2d40b5e9a18fe34888a9541e857797192bfc0f2611be469bb","fillTx":"0xd7a696a19dbed9d281fef7ba747b4d00ac86ae62e83840b050cfd987f9073fa2","fillTxnRef":"0xd7a696a19dbed9d281fef7ba747b4d00ac86ae62e83840b050cfd987f9073fa2","destinationChainId":8453,"depositRefundTxHash":null,"depositRefundTxnRef":null,"actionsSucceeded":null,"actionsTargetChainId":null,"pagination":{"currentIndex":0,"maxIndex":0}}`;

/** `GET /deposit/status`: a BSC deposit to Ethereum, refunded. */
export const refundedAnswer: string = `{"sweepTxnRef":null,"actionsTargetRecipient":null,"actionsTargetToken":null,"actionsTargetAmount":null,"actionsTargetTxnRef":null,"actionsTargetBlockTimestamp":null,"status":"refunded","originChainId":56,"depositId":"1269971","depositTxHash":"0x425a890b4c454be3ac17498847feacdeae3519144039112dea645070eac48838","depositTxnRef":"0x425a890b4c454be3ac17498847feacdeae3519144039112dea645070eac48838","fillTx":null,"fillTxnRef":null,"destinationChainId":1,"depositRefundTxHash":"0x815c159eafd5cca6e5792aa61c576c8e4eb870f16e4a52d41cc2a3d7c6ef0d8b","depositRefundTxnRef":"0x815c159eafd5cca6e5792aa61c576c8e4eb870f16e4a52d41cc2a3d7c6ef0d8b","actionsSucceeded":null,"actionsTargetChainId":null,"pagination":{"currentIndex":0,"maxIndex":0}}`;

/** `GET /deposit/status`: a BSC deposit to Robinhood Chain past its fill deadline. */
export const expiredAnswer: string = `{"sweepTxnRef":null,"actionsTargetRecipient":null,"actionsTargetToken":null,"actionsTargetAmount":null,"actionsTargetTxnRef":null,"actionsTargetBlockTimestamp":null,"status":"expired","originChainId":56,"depositId":"992097","depositTxHash":"0xffacfcc48391c408c021fc5c715842320b691c3ba59497a41826d951bdde4c1c","depositTxnRef":"0xffacfcc48391c408c021fc5c715842320b691c3ba59497a41826d951bdde4c1c","fillTx":null,"fillTxnRef":null,"destinationChainId":4663,"depositRefundTxHash":null,"depositRefundTxnRef":null,"actionsSucceeded":null,"actionsTargetChainId":null,"pagination":{"currentIndex":0,"maxIndex":0}}`;

/** `GET /deposit/status`: a deposit Across has not seen (HTTP 404). */
export const notFoundAnswer: string = `{"error":"DepositNotFoundException","message":"Deposit not found given the provided constraints"}`;
