import * as TheLogManager from 'aurelia-logging';
import {ViewEngine,BindingLanguage,ViewSlot,ViewResources,TemplatingEngine,CompositionTransaction} from 'aurelia-templating';
import {join} from 'aurelia-path';
import {Container} from 'aurelia-dependency-injection';
import {Loader} from 'aurelia-loader';
import {DOM,PLATFORM} from 'aurelia-pal';

/*eslint no-unused-vars:0, no-cond-assign:0*/
const logger = TheLogManager.getLogger('aurelia');

function runTasks(config, tasks) {
  let current;
  let next = () => {
    if (current = tasks.shift()) {
      return Promise.resolve(current(config)).then(next);
    }

    return Promise.resolve();
  };

  return next();
}

function loadPlugin(config, loader, info) {
  logger.debug(`Loading plugin ${info.moduleId}.`);
  config.resourcesRelativeTo = info.resourcesRelativeTo;

  return loader.loadModule(info.moduleId).then(m => {
    if ('configure' in m) {
      return Promise.resolve(m.configure(config, info.config || {})).then(() => {
        config.resourcesRelativeTo = null;
        logger.debug(`Configured plugin ${info.moduleId}.`);
      });
    }

    config.resourcesRelativeTo = null;
    logger.debug(`Loaded plugin ${info.moduleId}.`);
  });
}

function loadResources(container, resourcesToLoad, appResources) {
  let viewEngine = container.get(ViewEngine);
  let importIds = Object.keys(resourcesToLoad);
  let names = new Array(importIds.length);

  for (let i = 0, ii = importIds.length; i < ii; ++i) {
    names[i] = resourcesToLoad[importIds[i]];
  }

  return viewEngine.importViewResources(importIds, names, appResources);
}

function assertProcessed(plugins) {
  if (plugins.processed) {
    throw new Error('This config instance has already been applied. To load more plugins or global resources, create a new FrameworkConfiguration instance.');
  }
}

/**
 * Manages configuring the aurelia framework instance.
 */
export class FrameworkConfiguration {
  /**
   * The root DI container used by the application.
   */
  container: Container;

  /**
   * The aurelia instance.
   */
  aurelia: Aurelia;

  /**
   * Creates an instance of FrameworkConfiguration.
   * @param aurelia An instance of Aurelia.
   */
  constructor(aurelia: Aurelia) {
    this.aurelia = aurelia;
    this.container = aurelia.container;
    this.info = [];
    this.processed = false;
    this.preTasks = [];
    this.postTasks = [];
    this.resourcesToLoad = {};
    this.preTask(() => aurelia.loader.normalize('aurelia-bootstrapper').then(name => this.bootstrapperName = name));
    this.postTask(() => loadResources(aurelia.container, this.resourcesToLoad, aurelia.resources));
  }

  /**
   * Adds an existing object to the framework's dependency injection container.
   * @param type The object type of the dependency that the framework will inject.
   * @param instance The existing instance of the dependency that the framework will inject.
   * @return Returns the current FrameworkConfiguration instance.
   */
  instance(type: any, instance: any): FrameworkConfiguration {
    this.container.registerInstance(type, instance);
    return this;
  }

  /**
   * Adds a singleton to the framework's dependency injection container.
   * @param type The object type of the dependency that the framework will inject.
   * @param implementation The constructor function of the dependency that the framework will inject.
   * @return Returns the current FrameworkConfiguration instance.
   */
  singleton(type: any, implementation?: Function): FrameworkConfiguration {
    this.container.registerSingleton(type, implementation);
    return this;
  }

  /**
   * Adds a transient to the framework's dependency injection container.
   * @param type The object type of the dependency that the framework will inject.
   * @param implementation The constructor function of the dependency that the framework will inject.
   * @return Returns the current FrameworkConfiguration instance.
   */
  transient(type: any, implementation?: Function): FrameworkConfiguration {
    this.container.registerTransient(type, implementation);
    return this;
  }

  /**
   * Adds an async function that runs before the plugins are run.
   * @param task The function to run before start.
   * @return Returns the current FrameworkConfiguration instance.
   */
  preTask(task: Function): FrameworkConfiguration {
    assertProcessed(this);
    this.preTasks.push(task);
    return this;
  }

  /**
   * Adds an async function that runs after the plugins are run.
   * @param task The function to run after start.
   * @return Returns the current FrameworkConfiguration instance.
   */
  postTask(task: Function): FrameworkConfiguration {
    assertProcessed(this);
    this.postTasks.push(task);
    return this;
  }

  /**
   * Configures an internal feature plugin before Aurelia starts.
   * @param plugin The folder for the internal plugin to configure (expects an index.js in that folder).
   * @param config The configuration for the specified plugin.
   * @return Returns the current FrameworkConfiguration instance.
  */
  feature(plugin: string, config?: any): FrameworkConfiguration {
    plugin = plugin.endsWith('.js') || plugin.endsWith('.ts') ? plugin.substring(0, plugin.length - 3) : plugin;
    return this.plugin({ moduleId: plugin + '/index', resourcesRelativeTo: plugin, config: config || {} });
  }

  /**
   * Adds globally available view resources to be imported into the Aurelia framework.
   * @param resources The relative module id to the resource. (Relative to the plugin's installer.)
   * @return Returns the current FrameworkConfiguration instance.
   */
  globalResources(resources: string|string[]): FrameworkConfiguration {
    assertProcessed(this);

    let toAdd = Array.isArray(resources) ? resources : arguments;
    let resource;
    let path;
    let resourcesRelativeTo = this.resourcesRelativeTo || '';

    for (let i = 0, ii = toAdd.length; i < ii; ++i) {
      resource = toAdd[i];
      if (typeof resource !== 'string') {
        throw new Error(`Invalid resource path [${resource}]. Resources must be specified as relative module IDs.`);
      }

      path = join(resourcesRelativeTo, resource);
      this.resourcesToLoad[path] = this.resourcesToLoad[path];
    }

    return this;
  }

  /**
   * Renames a global resource that was imported.
   * @param resourcePath The path to the resource.
   * @param newName The new name.
   * @return Returns the current FrameworkConfiguration instance.
   */
  globalName(resourcePath: string, newName: string): FrameworkConfiguration {
    assertProcessed(this);
    this.resourcesToLoad[resourcePath] = newName;
    return this;
  }

  /**
   * Configures an external, 3rd party plugin before Aurelia starts.
   * @param plugin The ID of the 3rd party plugin to configure.
   * @param config The configuration for the specified plugin.
   * @return Returns the current FrameworkConfiguration instance.
 */
  plugin(plugin: string, config?: any): FrameworkConfiguration {
    assertProcessed(this);

    if (typeof(plugin) === 'string') {
      plugin = plugin.endsWith('.js') || plugin.endsWith('.ts') ? plugin.substring(0, plugin.length - 3) : plugin;
      return this.plugin({ moduleId: plugin, resourcesRelativeTo: plugin, config: config || {} });
    }

    this.info.push(plugin);
    return this;
  }

  _addNormalizedPlugin(name, config) {
    let plugin = { moduleId: name, resourcesRelativeTo: name, config: config || {} };

    this.plugin(plugin);
    this.preTask(() => {
      return this.aurelia.loader.normalize(name, this.bootstrapperName).then(normalizedName => {
        normalizedName = normalizedName.endsWith('.js') || normalizedName.endsWith('.ts')
          ? normalizedName.substring(0, normalizedName.length - 3) : normalizedName;

        plugin.moduleId = normalizedName;
        plugin.resourcesRelativeTo = normalizedName;
        this.aurelia.loader.map(name, normalizedName);
      });
    });

    return this;
  }

  /**
   * Plugs in the default binding language from aurelia-templating-binding.
   * @return Returns the current FrameworkConfiguration instance.
  */
  defaultBindingLanguage(): FrameworkConfiguration {
    return this._addNormalizedPlugin('aurelia-templating-binding');
  }

  /**
   * Plugs in the router from aurelia-templating-router.
   * @return Returns the current FrameworkConfiguration instance.
  */
  router(): FrameworkConfiguration {
    return this._addNormalizedPlugin('aurelia-templating-router');
  }

  /**
   * Plugs in the default history implementation from aurelia-history-browser.
   * @return Returns the current FrameworkConfiguration instance.
  */
  history(): FrameworkConfiguration {
    return this._addNormalizedPlugin('aurelia-history-browser');
  }

  /**
   * Plugs in the default templating resources (if, repeat, show, compose, etc.) from aurelia-templating-resources.
   * @return Returns the current FrameworkConfiguration instance.
  */
  defaultResources(): FrameworkConfiguration {
    return this._addNormalizedPlugin('aurelia-templating-resources');
  }

  /**
   * Plugs in the event aggregator from aurelia-event-aggregator.
   * @return Returns the current FrameworkConfiguration instance.
  */
  eventAggregator(): FrameworkConfiguration {
    return this._addNormalizedPlugin('aurelia-event-aggregator');
  }

  /**
   * Sets up the Aurelia configuration. This is equivalent to calling `.defaultBindingLanguage().defaultResources().history().router().eventAggregator();`
   * @return Returns the current FrameworkConfiguration instance.
  */
  standardConfiguration(): FrameworkConfiguration {
    return this.defaultBindingLanguage().defaultResources().history().router().eventAggregator();
  }

  /**
   * Plugs in the ConsoleAppender and sets the log level to debug.
   * @return {FrameworkConfiguration} Returns the current FrameworkConfiguration instance.
  */
  developmentLogging(): FrameworkConfiguration {
    this.preTask(() => {
      return this.aurelia.loader.normalize('aurelia-logging-console', this.bootstrapperName).then(name => {
        return this.aurelia.loader.loadModule(name).then(m => {
          TheLogManager.addAppender(new m.ConsoleAppender());
          TheLogManager.setLevel(TheLogManager.logLevel.debug);
        });
      });
    });

    return this;
  }

  /**
   * Loads and configures the plugins registered with this instance.
   * @return Returns a promise which resolves when all plugins are loaded and configured.
  */
  apply(): Promise<void> {
    if (this.processed) {
      return Promise.resolve();
    }

    return runTasks(this, this.preTasks).then(() => {
      let loader = this.aurelia.loader;
      let info = this.info;
      let current;

      let next = () => {
        if (current = info.shift()) {
          return loadPlugin(this, loader, current).then(next);
        }

        this.processed = true;
        return Promise.resolve();
      };

      return next().then(() => runTasks(this, this.postTasks));
    });
  }
}

/*eslint no-unused-vars:0*/
function preventActionlessFormSubmit() {
  DOM.addEventListener('submit', evt => {
    const target = evt.target;
    const action = target.action;

    if (target.tagName.toLowerCase() === 'form' && !action) {
      evt.preventDefault();
    }
  });
}

/**
 * The framework core that provides the main Aurelia object.
 */
export class Aurelia {
  /**
   * The loader used by the application.
   */
  loader: Loader;
  /**
   * The root DI container used by the application.
   */
  container: Container;
  /**
   * The global view resources used by the application.
   */
  resources: ViewResources;

  /**
   * The configuration used during application startup.
   */
  use: FrameworkConfiguration;

  /**
   * Creates an instance of Aurelia.
   * @param loader The loader for this Aurelia instance to use. If a loader is not specified, Aurelia will use the loader type specified by PLATFORM.Loader.
   * @param container The dependency injection container for this Aurelia instance to use. If a container is not specified, Aurelia will create an empty, global container.
   * @param resources The resource registry for this Aurelia instance to use. If a resource registry is not specified, Aurelia will create an empty registry.
   */
  constructor(loader?: Loader, container?: Container, resources?: ViewResources) {
    this.loader = loader || new PLATFORM.Loader();
    this.container = container || (new Container()).makeGlobal();
    this.resources = resources || new ViewResources();
    this.use = new FrameworkConfiguration(this);
    this.logger = TheLogManager.getLogger('aurelia');
    this.hostConfigured = false;
    this.host = null;

    this.use.instance(Aurelia, this);
    this.use.instance(Loader, this.loader);
    this.use.instance(ViewResources, this.resources);
  }

  /**
   * Loads plugins, then resources, and then starts the Aurelia instance.
   * @return Returns a Promise with the started Aurelia instance.
   */
  start(): Promise<Aurelia> {
    if (this.started) {
      return Promise.resolve(this);
    }

    this.started = true;
    this.logger.info('Aurelia Starting');

    return this.use.apply().then(() => {
      preventActionlessFormSubmit();

      if (!this.container.hasResolver(BindingLanguage)) {
        let message = 'You must configure Aurelia with a BindingLanguage implementation.';
        this.logger.error(message);
        throw new Error(message);
      }

      this.logger.info('Aurelia Started');
      let evt = DOM.createCustomEvent('aurelia-started', { bubbles: true, cancelable: true });
      DOM.dispatchEvent(evt);
      return this;
    });
  }

  /**
   * Enhances the host's existing elements with behaviors and bindings.
   * @param bindingContext A binding context for the enhanced elements.
   * @param applicationHost The DOM object that Aurelia will enhance.
   * @return Returns a Promise for the current Aurelia instance.
   */
  enhance(bindingContext: Object = {}, applicationHost: string | Element = null): Promise<Aurelia> {
    this._configureHost(applicationHost);

    return new Promise(resolve => {
      let engine = this.container.get(TemplatingEngine);
      this.root = engine.enhance({container: this.container, element: this.host, resources: this.resources, bindingContext: bindingContext});
      this.root.attached();
      this._onAureliaComposed();
      return this;
    });
  }

  /**
   * Instantiates the root component and adds it to the DOM.
   * @param root The root component to load upon bootstrap.
   * @param applicationHost The DOM object that Aurelia will attach to.
   * @return Returns a Promise of the current Aurelia instance.
   */
  setRoot(root: string = 'app', applicationHost: string | Element = null): Promise<Aurelia> {
    let instruction = {};

    if (this.root && this.root.viewModel && this.root.viewModel.router) {
      this.root.viewModel.router.deactivate();
      this.root.viewModel.router.reset();
    }

    this._configureHost(applicationHost);

    let engine = this.container.get(TemplatingEngine);
    let transaction = this.container.get(CompositionTransaction);
    delete transaction.initialComposition;

    instruction.viewModel = root;
    instruction.container = instruction.childContainer = this.container;
    instruction.viewSlot = this.hostSlot;
    instruction.host = this.host;

    return engine.compose(instruction).then(r => {
      this.root = r;
      instruction.viewSlot.attached();
      this._onAureliaComposed();
      return this;
    });
  }

  _configureHost(applicationHost) {
    if (this.hostConfigured) {
      return;
    }

    applicationHost = applicationHost || this.host;

    if (!applicationHost || typeof applicationHost === 'string') {
      this.host = DOM.getElementById(applicationHost || 'applicationHost');
    } else {
      this.host = applicationHost;
    }

    if (!this.host) {
      throw new Error('No applicationHost was specified.');
    }

    this.hostConfigured = true;
    this.host.aurelia = this;
    this.hostSlot = new ViewSlot(this.host, true);
    this.hostSlot.transformChildNodesIntoView();
    this.container.registerInstance(DOM.boundary, this.host);
  }

  _onAureliaComposed() {
    let evt = DOM.createCustomEvent('aurelia-composed', { bubbles: true, cancelable: true });
    setTimeout(() => DOM.dispatchEvent(evt), 1);
  }
}

export * from 'aurelia-dependency-injection';
export * from 'aurelia-binding';
export * from 'aurelia-metadata';
export * from 'aurelia-templating';
export * from 'aurelia-loader';
export * from 'aurelia-task-queue';
export * from 'aurelia-path';
export * from 'aurelia-pal';

/**
 * The log manager.
 */
export const LogManager = TheLogManager;
