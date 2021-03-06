import { Injectable } from "@angular/core";
import { NavController, App, ModalController, 
  ModalOptions, Modal, NavOptions, Events, 
  PopoverController, PopoverOptions,
  AlertController, AlertOptions,
  PickerController, PickerOptions,
  ActionSheetController, ActionSheetOptions,
  LoadingController, LoadingOptions, Nav } from "ionic-angular";
import { BackManagerProvider } from "./back-manager";
import { Observable } from "rxjs/Observable";
import "rxjs/add/operator/toPromise";

interface TypeToFunctionNameMapItem {
  [typeKey: string]: string;
}

interface LocalNavsMap {
  [typeKey: string]: NavController;
}

export class QueuedItem {

  private typeToFunctionNameMap: TypeToFunctionNameMapItem = {
    "push": "tryPushPage",
    "pushLocal": "tryLocalPushPage",
    "setRoot": "trySetRootPage",
    "setRootLocal": "trySetLocalRootPage",
    "modal": "tryPresentModal",
    "popover": "tryPresentPopover",
    "alert": "tryPresentAlert",
    "actionSheet": "tryPresentActionSheet",
    "loading": "tryPresentLoading",
    "picker": "tryPresentPicker"
  };

  private observer: any;

  constructor(
    private globalNavLocker: GlobalNavLocker,
    public type: "push" | "pushLocal" | "setRoot" | "setRootLocal" | "modal" | "popover" | "alert" | "actionSheet" | "loading" | "picker", 
    public args: any[]
  ) {}

  setObserver(observer: any) {
    this.observer = observer;
  }

  call() {
    let action = this.globalNavLocker.getMethod(this.typeToFunctionNameMap[this.type]);
    let promise = action.apply(this.globalNavLocker, this.args)
      .then((args: any) => {
        this.observer.next(args);
        this.observer.complete();
      })
      .catch((args: any) => {
        this.observer.error(args);
        this.observer.complete();
      });
  }
}

@Injectable()
export class GlobalNavLocker {
  private nav: NavController;
  private localNavs: LocalNavsMap = {};
  private pageLock: boolean = false;
  private queue: QueuedItem[] = [];

  constructor(
    app: App, 
    private events: Events,
    private modalCtrl: ModalController,
    private popoverCtrl: PopoverController,
    private alertCtrl: AlertController,
    private pickerCtrl: PickerController,
    private actionSheetCtrl: ActionSheetController,
    private loadingCtrl: LoadingController,
    private backManager: BackManagerProvider
  ) {
    this.pageLock = false;
    this.nav = app.getRootNav();
  }

  getMethod(methodName: string) {
    switch (methodName) {
      case "tryPushPage":
        return this.tryPushPage;

      case "trySetRootPage":
        return this.trySetRootPage;

      case "tryPresentModal":
        return this.tryPresentModal;

      case "tryPresentPopover":
        return this.tryPresentPopover;

      case "tryPresentAlert":
        return this.tryPresentAlert;

      case "tryPresentActionSheet":
        return this.tryPresentActionSheet;

      case "tryPresentLoading":
        return this.tryPresentLoading;

      case "tryPresentPicker":
        return this.tryPresentPicker;
        
      default:
        return () => {};
    }
  }

  public setNav(nav: any) {
    this.nav = nav;
  }

  public getNav(): NavController {
    return this.nav;
  }

  public addLocalNav(key: string, nav: NavController) {
    this.localNavs[key] = nav;
  }

  public removeLocalNav(key: string) {
    delete this.localNavs[key];
  }

  public listLocalNavs(): {key: string, value: NavController}[] {
    let localNavsList:{key: string, value: NavController}[] = [];

    for (let key in this.localNavs) {
      localNavsList.push({key: key, value: this.localNavs[key]})
    }

    return localNavsList;
  }

  public getPageLock() {
    return this.pageLock;
  }

  public tryLock() {
    if (this.pageLock) {
      return false;
    }

    this.pageLock = true;
    return true;
  }

  private tryLockAndDoSomething(callback: any) {
    let self = this;
    let observable: Observable<any> = Observable.create((observer: any) => {
      if (self.tryLock()) {
        callback(observer);
      } else {
        observer.error();
        observer.complete();
      }
    });

    return observable.toPromise();
  }

  public unlock() {
    this.pageLock = false;
    let queuedItem = this.queue.shift();
    if (queuedItem) {
      queuedItem.call();
    }
  }

  public forceUnlock() {
    this.pageLock = false;
  }

  private enqueueSomething(item: QueuedItem) {
    return Observable.create((observer: any) => {
      if (this.pageLock) {
        item.setObserver(observer);
        this.queue.push(item);
      } else {
        item.setObserver(observer);
        item.call();
      }
    }).toPromise();
  }

  public enqueuePushPage(page: any, params?: any, opts?: NavOptions, done?: Function) {
    return this.enqueueSomething(new QueuedItem(this, "push", [page, params, opts, done]));
  }


  public tryPushPage(page: any, params?: any, opts?: NavOptions, done?: Function) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      self.backManager.pushCallback(() => {
        return Observable.create((backObserver: any) => {
          self.backManager.popCallback();
          self.nav.pop();
          backObserver.next();
          backObserver.complete();
        });
      });

      let customDone = function() {
        self.unlock();
        if (done !== undefined) {
          return done(arguments);
        }
      };

      let promise = self.nav.push(page, params, opts, customDone);

      if (promise !== undefined) {
        promise
          .then(() => {
            observer.next();
            observer.complete();
          })
          .catch((args) => {
            self.events.publish("permissionDeniedRedirect");
            observer.error();
            observer.complete();
          });
      } else {
        observer.next();
        observer.complete();
      }
    });
  }


  public enqueuePushLocalPage(key: string, page: any, params?: any, opts?: NavOptions, done?: Function) {
    return this.enqueueSomething(new QueuedItem(this, "pushLocal", [key, page, params, opts, done]));
  }

  public tryLocalPushPage(key: string, page: any, params?: any, opts?: NavOptions, done?: Function) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      self.backManager.pushCallback(() => {
        return Observable.create((backObserver: any) => {
          self.backManager.popCallback();
          self.localNavs[key].pop();
          backObserver.next();
          backObserver.complete();
        });
      });

      let customDone = function() {
        self.unlock();
        if (done !== undefined) {
          return done(arguments);
        }
      };

      let promise = self.localNavs[key].push(page, params, opts, customDone);

      if (promise !== undefined) {
        promise
          .then(() => {
            observer.next();
            observer.complete();
          })
          .catch((args) => {
            self.events.publish("permissionDeniedRedirect");
            observer.error();
            observer.complete();
          });
      } else {
        observer.next();
        observer.complete();
      }
    });
  }

  public enqueueSetRootPage(page: any, params?: any, opts?: NavOptions, done?: Function) {
    return this.enqueueSomething(new QueuedItem(this, "setRoot", [page, params, opts, done]));
  }

  public trySetRootPage(page: any, params?: any, opts?: NavOptions, done?: Function) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      this.backManager.setRootCallback();

      let customDone = function() {
        self.unlock();
        if (done !== undefined) {
          return done(arguments);
        }
      };

      let promise = this.nav.setRoot(page, params, opts, customDone);
      if (promise !== undefined) {
        promise
          .then(() => {
            observer.next();
            observer.complete();
          })
          .catch(() => {
            self.events.publish("permissionDeniedRedirect");
            observer.error();
            observer.complete();
          });
      } else {
        observer.next();
        observer.complete();
      }
    });
  }

  public enqueueSetLocalRootPage(key: number, page: any, params?: any, opts?: NavOptions, done?: Function) {
    return this.enqueueSomething(new QueuedItem(this, "setRootLocal", [key, page, params, opts, done]));
  }

  public trySetLocalRootPage(key: string, page: any, params?: any, opts?: NavOptions, done?: Function) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      this.backManager.setRootCallback();

      let customDone = function() {
        self.unlock();
        if (done !== undefined) {
          return done(arguments);
        }
      };

      let promise = this.localNavs[key].setRoot(page, params, opts, customDone);
      if (promise !== undefined) {
        promise
          .then(() => {
            observer.next();
            observer.complete();
          })
          .catch(() => {
            self.events.publish("permissionDeniedRedirect");
            observer.error();
            observer.complete();
          });
      } else {
        observer.next();
        observer.complete();
      }
    });
  }


  public enqueuePresentModal(component: any, data?: any, opts?: ModalOptions) {
    return this.enqueueSomething(new QueuedItem(this, "modal", [component, data, opts]));
  }

  public tryPresentModal(component: any, data?: any, opts?: ModalOptions) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      let modal = this.modalCtrl.create(component, data, opts);
      let originalModalDismiss = modal.dismiss;
      self.backManager.pushCallback((args?: any) => {
        return Observable.create((backObserver: any) => {
          let data, role, navOptions;
          if (args !== undefined) {
            data = args.data;
            role = args.role;
            navOptions = args.navOptions;
          }
          originalModalDismiss.call(modal, data, role, navOptions)
            .then(() => {
              self.backManager.popCallback();
              backObserver.next();
              backObserver.complete();
            })
            .catch(() => {
              backObserver.error();
              backObserver.complete();
            });
        });
      });
      modal.dismiss = (data?: any, role?: any, navOptions?: NavOptions) => {
        let args = {
          data: data, 
          role: role, 
          navOptions: navOptions
        };
        return self.tryBack(args).toPromise();
      };
      
      modal.present()
        .then(() => {
          self.unlock();
          observer.next(modal);
          observer.complete();
        })
        .catch(() => {
          self.unlock();
          observer.error(modal);
          observer.complete();
        });
      
    });
  }


  public enqueuePresentPopover(component: any, data?: any, opts?: PopoverOptions) {
    return this.enqueueSomething(new QueuedItem(this, "popover", [component, data, opts]));
  }

  public tryPresentPopover(component: any, data?: any, opts?: PopoverOptions) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      let popover = this.popoverCtrl.create(component, data, opts);
      let originalPopoverDismiss = popover.dismiss;
      self.backManager.pushCallback((args?: any) => {
        return Observable.create((backObserver: any) => {
          let data, role, navOptions;
          if (args !== undefined) {
            data = args.data;
            role = args.role;
            navOptions = args.navOptions;
          }
          originalPopoverDismiss.call(popover, data, role, navOptions)
            .then(() => {
              self.backManager.popCallback();
              backObserver.next();
              backObserver.complete();
            })
            .catch(() => {
              backObserver.error();
              backObserver.complete();
            });
        });
      });
      popover.dismiss = (data?: any, role?: any, navOptions?: NavOptions) => {
        let args = {
          data: data, 
          role: role, 
          navOptions: navOptions
        };
        return self.tryBack(args).toPromise();
      };
      
      popover.present()
        .then(() => {
          observer.next(popover);
          observer.complete();
        })
        .catch(() => {
          observer.error(popover);
          observer.complete();
        });
      
    });
  }

  public enqueuePresentLoading(opts?: LoadingOptions) {
    return this.enqueueSomething(new QueuedItem(this, "loading", [opts]));
  }

  public tryPresentLoading(opts?: LoadingOptions) {
    let self = this;

    let observable = self.tryLockAndDoSomething((observer: any) => {
      let loading = this.loadingCtrl.create(opts);
      let originalLoadingDismiss = loading.dismiss;
      self.backManager.pushCallback((args?: any) => {
        return Observable.create((observer: any) => {
          observer.next();
          observer.complete();
        });
      });

      loading.dismiss = (data?: any, role?: any, navOptions?: NavOptions) => {
        self.backManager.popCallback();
        self.unlock();
        return originalLoadingDismiss.call(loading, data, role, navOptions);
      };
      loading.present()
        .then(() => {
          observer.next(loading);
          observer.complete();
        })
        .catch(() => {
          observer.error(loading);
          observer.complete();
        });
    });

    return observable;
  }

  public enqueuePresentAlert(opts?: AlertOptions) {
    return this.enqueueSomething(new QueuedItem(this, "alert", [opts]));
  }

  public tryPresentAlert(opts?: AlertOptions) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      let alert = this.alertCtrl.create(opts);
      let originalAlertDismiss = alert.dismiss;
      self.backManager.pushCallback((args?: any) => {
        return Observable.create((backObserver: any) => {
          let data, role, navOptions;
          if (args !== undefined) {
            data = args.data;
            role = args.role;
            navOptions = args.navOptions;
          }
          originalAlertDismiss.call(alert, data, role, navOptions)
            .then(() => {
              self.backManager.popCallback();
              backObserver.next();
              backObserver.complete();
            })
            .catch(() => {
              backObserver.error();
              backObserver.complete();
            });
          
        });
      });
      alert.dismiss = (data?: any, role?: any, navOptions?: NavOptions) => {
        let args = {
          data: data, 
          role: role, 
          navOptions: navOptions
        };
        return self.tryBack(args).toPromise().catch(() => {});
      };
      alert.present()
        .then(() => {
          self.unlock();
          observer.next(alert);
          observer.complete();
        })
        .catch(() => {
          observer.error(alert);
          observer.complete();
        });
    });
  }

  public enqueuePresentPicker(opts: any) {
    return this.enqueueSomething(new QueuedItem(this, "picker", [opts]));
  }

  public tryPresentPicker(opts?: PickerOptions) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      let picker = this.pickerCtrl.create(opts);
      let originalPickerDismiss = picker.dismiss;
      self.backManager.pushCallback((args?: any) => {
        return Observable.create((backObserver: any) => {
          let data, role, navOptions;
          if (args !== undefined) {
            data = args.data;
            role = args.role;
            navOptions = args.navOptions;
          }
          originalPickerDismiss.call(picker, data, role, navOptions)
            .then(() => {
              self.backManager.popCallback();
              backObserver.next();
              backObserver.complete();
            })
            .catch(() => {
              backObserver.error();
              backObserver.complete();
            });
          
        });
      });
      picker.dismiss = (data?: any, role?: any, navOptions?: NavOptions) => {
        let args = {
          data: data, 
          role: role, 
          navOptions: navOptions
        };
        return self.tryBack(args).toPromise().catch(() => {});
      };
      picker.present()
        .then(() => {
          self.unlock();
          observer.next(picker);
          observer.complete();
        })
        .catch(() => {
          observer.error(picker);
          observer.complete();
        });
    });
  }

  public enqueuePresentActionSheet(opts: any) {
    return this.enqueueSomething(new QueuedItem(this, "actionSheet", [opts]));
  }

  public tryPresentActionSheet(opts?: ActionSheetOptions) {
    let self = this;
    return self.tryLockAndDoSomething((observer: any) => {
      let actionSheet = this.actionSheetCtrl.create(opts);
      let originalActionSheetDismiss = actionSheet.dismiss;
      self.backManager.pushCallback((args?: any) => {
        return Observable.create((backObserver: any) => {
          let data, role, navOptions;
          if (args !== undefined) {
            data = args.data;
            role = args.role;
            navOptions = args.navOptions;
          }
          originalActionSheetDismiss.call(actionSheet, data, role, navOptions)
            .then(() => {
              self.backManager.popCallback();
              backObserver.next();
              backObserver.complete();
            })
            .catch(() => {
              backObserver.error();
              backObserver.complete();
            });
          
        });
      });
      actionSheet.dismiss = (data?: any, role?: any, navOptions?: NavOptions) => {
        let args = {
          data: data, 
          role: role, 
          navOptions: navOptions
        };
        return self.tryBack(args).toPromise().catch(() => {});
      };
      actionSheet.present()
        .then(() => {
          self.unlock();
          observer.next(actionSheet);
          observer.complete();
        })
        .catch(() => {
          observer.error(actionSheet);
          observer.complete();
        });
    });
  }

  public tryBack(args?: any) {
    let self = this;
    let observable = Observable.create((observer: any) => {
      if (self.tryLock()) {
        self.backManager.back(args).subscribe(
          () => {
            observer.next();
            self.unlock();
            observer.complete();
          },
          () => {
            observer.error();
            self.unlock();
            observer.complete();
          }
        );
      } else {
        observer.error();
        observer.complete();
      }
    });

    observable.subscribe(() => {}, () => {});

    return observable;
  }

}	