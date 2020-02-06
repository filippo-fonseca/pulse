import Pulse, { State, Computed } from './';
import { copy } from './utils';
import {
  CallbackContainer,
  ComponentContainer,
  SubscriptionContainer
} from './sub';

export interface Job {
  state: State;
  newState: any;
}
export default class Runtime {
  private current: Job = null;
  private queue: Array<Job> = [];
  private complete: Array<Job> = [];
  constructor(private instance: Pulse) {}

  public ingest(state: State, newState: any) {
    let job: Job = { state, newState };
    this.queue.push(job);
    if (!this.current) this.nextJob();
  }

  private nextJob() {
    let job: Job = this.queue.shift();
    if (job) this.perform(job);
  }

  private perform(job: Job): void {
    this.current = job;
    job.state.previousState = copy(job.state.value);

    // write new value as result of mutation
    job.state.privateWrite(job.newState);

    // set next state for future mutations
    job.state.nextState = copy(job.newState);

    // perform side effects
    this.sideEffects(job.state);

    // declare completed
    this.complete.push(job);
    // console.log('job', job);
    this.current = null;
    this.nextJob();
  }

  private sideEffects(state: State) {
    let dep = state.dep;

    // cleanup dynamic deps
    dep.dynamic.forEach(state => {
      state.dep.deps.delete(dep);
    });
    dep.dynamic = new Set();

    // ingest dependents
    dep.deps.forEach(state => {
      if (state instanceof Computed) {
        this.ingest(state, state.mutation());
      }
    });
  }

  updateSubscribers() {
    let componentsToUpdate: Set<SubscriptionContainer>;
    // loop through completed jobs
    this.complete.forEach(job => {
      // loop through subs of this job
      job.state.dep.subs.forEach(cC => {
        // for containers that require props to be passed
        if (cC.passProps) {
          let localKey: string;
          // find the local key for this update by comparing the State instance from this job to the state instances in the mappedStates object
          for (let key in cC.mappedStates)
            if (cC.mappedStates[key] === job.state) localKey = key;
          // once a matching key is found push it into the SubscriptionContainer
          if (localKey) cC.keysChanged.push(localKey);
        }
        // save this component
        componentsToUpdate.add(cC);
      });
    });
    // perform component or callback updates
    componentsToUpdate.forEach(cC => {
      // are we dealing with a CallbackContainer?
      if (cC instanceof CallbackContainer) {
        // just invoke the callback
        (cC as CallbackContainer).callback();

        // is this a ComponentContainer
      } else if (cC instanceof ComponentContainer) {
        // call the current intergration's update method
        this.instance.intergration.updateMethod(
          cC.instance,
          Runtime.assembleUpdatedValues(cC)
        );
      }
    });
  }

  static assembleUpdatedValues(cC: SubscriptionContainer) {
    let returnObj: any = {};
    cC.keysChanged.forEach(changedKey => {
      // extract the value from State for changed keys
      returnObj[changedKey] = cC.mappedStates[changedKey].value;
    });
    return returnObj;
  }
}
