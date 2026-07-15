export * from "@lyra/wdio-native-utils-upstream";

let warnedMissingInternals = false;

export function installMockSyncOverride(browser, commandName, syncMocks) {
  const elementOverrides = browser.__propertiesObject__?.__elementOverrides__?.value;
  if (!elementOverrides && !browser.isMultiremote && !warnedMissingInternals) {
    warnedMissingInternals = true;
    browser.logger?.warn?.(
      `Could not read WebdriverIO's element-override map while installing the '${commandName}' override; ` +
        "a user override of this command may be clobbered."
    );
  }
  const existing = elementOverrides?.[commandName];
  const override = async function (originalCommand, ...args) {
    const serviceCommand = async (...innerArgs) => {
      const result = await Reflect.apply(originalCommand, this, innerArgs);
      await syncMocks(this);
      return result;
    };
    return existing ? existing.apply(this, [serviceCommand, ...args]) : serviceCommand(...args);
  };
  browser.overwriteCommand(commandName, override, true);
}
