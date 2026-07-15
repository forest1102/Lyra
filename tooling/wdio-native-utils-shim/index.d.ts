export * from "@lyra/wdio-native-utils-upstream";
export declare function installMockSyncOverride(
  browser: WebdriverIO.Browser,
  commandName: string,
  syncMocks: (element: WebdriverIO.Element) => Promise<void>
): void;
