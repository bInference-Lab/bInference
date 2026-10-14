// The headers the launch search read and the receipts of the launch blocks it read, from BNB
// Chain's public node with the calls in ./recorded-answers.ts (block 127658612), the receipts
// trimmed to the first of each block and those with a log of the two launches' curves, each
// keeping only its logs' addresses and topics.

/** A recorded block header: its number and its time in seconds, as hex quantities. */
export interface RecordedHeader {
  readonly number: string;
  readonly timestamp: string;
}

/** One log of a recorded receipt: the contract that emitted it and its topics. */
export interface RecordedLog {
  readonly address: string;
  readonly topics: readonly string[];
}

/** Every header read, by the block tag asked: `latest` or a hex number. */
export const recordedHeaders: ReadonlyMap<string, RecordedHeader> = new Map([
  ["latest", { number: "0x79bea74", timestamp: "0x6acfe5cf" }],
  ["0x79a7d80", { number: "0x79a7d80", timestamp: "0x6acf4184" }],
  ["0x79b1fca", { number: "0x79b1fca", timestamp: "0x6acf8a94" }],
  ["0x79b1fc7", { number: "0x79b1fc7", timestamp: "0x6acf8a93" }],
  ["0x79b1fc6", { number: "0x79b1fc6", timestamp: "0x6acf8a93" }],
  ["0x79b1fc5", { number: "0x79b1fc5", timestamp: "0x6acf8a92" }],
  ["0x79b1fc8", { number: "0x79b1fc8", timestamp: "0x6acf8a93" }],
  ["0x79b1fc9", { number: "0x79b1fc9", timestamp: "0x6acf8a94" }],
  ["0x714a4ac", { number: "0x714a4ac", timestamp: "0x6a92fdd6" }],
  ["0x750ce45", { number: "0x750ce45", timestamp: "0x6aae1465" }],
  ["0x750ce35", { number: "0x750ce35", timestamp: "0x6aae145e" }],
  ["0x750ce34", { number: "0x750ce34", timestamp: "0x6aae145d" }],
  ["0x750ce36", { number: "0x750ce36", timestamp: "0x6aae145e" }],
  ["0x750ce37", { number: "0x750ce37", timestamp: "0x6aae145f" }],
]);

/** Every block's receipts read, by its hex number, as the logs of each receipt kept. */
export const recordedReceipts: ReadonlyMap<string, readonly (readonly RecordedLog[])[]> = new Map([
  [
    "0x79b1fc7",
    [
      [],
      [
        {
          address: "0xe7c7b7ee71db0f1b4f0ff25d7cec191268e7fd98",
          topics: [
            "0x3d0ce9bfc3ed7d6862dbb28b2dea94561fe714a1b4d019aa8af39730d1ad7c3d",
            "0x00000000000000000000000037ee8aee29c5efd3c1a7eda6df3f510779928a37",
          ],
        },
        {
          address: "0x7d227534c39c41033af86dbc8ade1bf8d68b0157",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            "0x0000000000000000000000001a3f3cf9de26982b6620366591dc145a2e657c7a",
          ],
        },
        {
          address: "0x1a3f3cf9de26982b6620366591dc145a2e657c7a",
          topics: [
            "0xb90314909854d06beb5fdd2a4cb666fbea0b93159229773f271dcea946e78259",
            "0x0000000000000000000000007d227534c39c41033af86dbc8ade1bf8d68b0157",
          ],
        },
        {
          address: "0x1a3f3cf9de26982b6620366591dc145a2e657c7a",
          topics: ["0x908408e307fc569b417f6cbec5d5a06f44a0a505ac0479b47d421a4b2fd6a1e6"],
        },
        {
          address: "0x1a3f3cf9de26982b6620366591dc145a2e657c7a",
          topics: [
            "0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7",
            "0x000000000000000000000000f31af6202b50a51cc1f98426b66dbfc5fcbeaff9",
          ],
        },
        {
          address: "0x37ee8aee29c5efd3c1a7eda6df3f510779928a37",
          topics: [
            "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607",
            "0x0000000000000000000000007d227534c39c41033af86dbc8ade1bf8d68b0157",
            "0x0000000000000000000000001a3f3cf9de26982b6620366591dc145a2e657c7a",
            "0x000000000000000000000000f31af6202b50a51cc1f98426b66dbfc5fcbeaff9",
          ],
        },
        {
          address: "0x1a3f3cf9de26982b6620366591dc145a2e657c7a",
          topics: [
            "0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7",
            "0x000000000000000000000000f31af6202b50a51cc1f98426b66dbfc5fcbeaff9",
          ],
        },
        {
          address: "0x7d227534c39c41033af86dbc8ade1bf8d68b0157",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000001a3f3cf9de26982b6620366591dc145a2e657c7a",
            "0x000000000000000000000000f31af6202b50a51cc1f98426b66dbfc5fcbeaff9",
          ],
        },
        {
          address: "0x1a3f3cf9de26982b6620366591dc145a2e657c7a",
          topics: [
            "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
            "0x000000000000000000000000d8b71b46498a36a4607eab5c735bee1dab7f263d",
            "0x000000000000000000000000f31af6202b50a51cc1f98426b66dbfc5fcbeaff9",
          ],
        },
        {
          address: "0xd8b71b46498a36a4607eab5c735bee1dab7f263d",
          topics: [
            "0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37",
            "0x0000000000000000000000007d227534c39c41033af86dbc8ade1bf8d68b0157",
            "0x0000000000000000000000001a3f3cf9de26982b6620366591dc145a2e657c7a",
            "0x000000000000000000000000f31af6202b50a51cc1f98426b66dbfc5fcbeaff9",
          ],
        },
      ],
    ],
  ],
  ["0x79b1fc6", [[]]],
  ["0x79b1fc8", [[]]],
  [
    "0x750ce36",
    [
      [],
      [
        {
          address: "0x4b8f01455c13e872d6910f728cf953db87ed68bc",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000001a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
            "0x000000000000000000000000558eb893b77f79fd2c12997e8f4fb3ef61736e4f",
          ],
        },
        {
          address: "0x1a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
          topics: [
            "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
            "0x000000000000000000000000558eb893b77f79fd2c12997e8f4fb3ef61736e4f",
            "0x000000000000000000000000558eb893b77f79fd2c12997e8f4fb3ef61736e4f",
          ],
        },
      ],
    ],
  ],
  [
    "0x750ce35",
    [
      [],
      [
        {
          address: "0xe7c7b7ee71db0f1b4f0ff25d7cec191268e7fd98",
          topics: [
            "0x3d0ce9bfc3ed7d6862dbb28b2dea94561fe714a1b4d019aa8af39730d1ad7c3d",
            "0x00000000000000000000000078eae9537c0ef90dfe9b7ae964682fe8138afe31",
          ],
        },
        {
          address: "0x4b8f01455c13e872d6910f728cf953db87ed68bc",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            "0x0000000000000000000000001a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
          ],
        },
        {
          address: "0x1a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
          topics: [
            "0xb90314909854d06beb5fdd2a4cb666fbea0b93159229773f271dcea946e78259",
            "0x0000000000000000000000004b8f01455c13e872d6910f728cf953db87ed68bc",
          ],
        },
        {
          address: "0x1a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
          topics: ["0x908408e307fc569b417f6cbec5d5a06f44a0a505ac0479b47d421a4b2fd6a1e6"],
        },
        {
          address: "0x1a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
          topics: [
            "0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7",
            "0x00000000000000000000000051a28df7321513b9ed7e3737c274608bec80eee3",
          ],
        },
        {
          address: "0x78eae9537c0ef90dfe9b7ae964682fe8138afe31",
          topics: [
            "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607",
            "0x0000000000000000000000004b8f01455c13e872d6910f728cf953db87ed68bc",
            "0x0000000000000000000000001a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
            "0x00000000000000000000000051a28df7321513b9ed7e3737c274608bec80eee3",
          ],
        },
        {
          address: "0x4b8f01455c13e872d6910f728cf953db87ed68bc",
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x0000000000000000000000001a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
            "0x00000000000000000000000051a28df7321513b9ed7e3737c274608bec80eee3",
          ],
        },
        {
          address: "0x1a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
          topics: [
            "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
            "0x0000000000000000000000002ef00378984e84f2daa08dfb5fb03bbde2038ae6",
            "0x00000000000000000000000051a28df7321513b9ed7e3737c274608bec80eee3",
          ],
        },
        {
          address: "0x2ef00378984e84f2daa08dfb5fb03bbde2038ae6",
          topics: [
            "0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37",
            "0x0000000000000000000000004b8f01455c13e872d6910f728cf953db87ed68bc",
            "0x0000000000000000000000001a3ab1c7aef910dfb7cf968ae71d914c2b55befa",
            "0x00000000000000000000000051a28df7321513b9ed7e3737c274608bec80eee3",
          ],
        },
      ],
    ],
  ],
]);
