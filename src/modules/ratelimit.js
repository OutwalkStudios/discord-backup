export class RateLimitManager {

    constructor(chunk = 50, timeWait = 10000, timePerRequest = 750) {

        this.counter = 0;
        this.totalCount = 0;
        this.chunk = chunk;
        this.timeWait = timeWait;
        this.timePerRequest = timePerRequest;

        this.queue = [];
        this.process = false;
    }

    resolver(dataPromised, callback, ...args) {
        return new Promise(async (resolve) => {
            if (!dataPromised && !callback) return resolve(null);

            const internalCallback = (result) => {
                if (result == "xDFhjdgsdg") console.log("Rate Limit executor timeout");
                resolve(result);
            };

            if (Array.isArray(dataPromised)) {
                for (let [_this, _func, ..._args] of dataPromised) {
                    this.queue.push([_this, _func, internalCallback, ..._args]);
                }
            } else {
                this.queue.push([dataPromised, callback, internalCallback, ...args]);
            }

            if (!this.process) {
                this.process = true;

                do {
                    await this._process(...this.queue.shift());
                } while (this.queue.length > 0);

                this.process = false;
                console.log("finished");
            }
        });
    }

    _process(dataPromised, callback, next, ...args) {
        return new Promise(async (resolve) => {
            if (!dataPromised) return resolve(null);

            await new Promise((res) => setTimeout(res, this.timePerRequest));

            this.totalCount++;
            console.log("request ", this.totalCount);

            if (this.counter >= this.chunk) {
                await new Promise((resolve) => setTimeout(resolve, this.timeWait));
                this.counter = 0;
            }

            this.counter++;

            const timeout = setTimeout(() => resolve("xDFhjdgsdg"), 15000);

            let resultResolved;

            try {
                if (!callback && typeof dataPromised == "function") {
                    resultResolved = await dataPromised.call(dataPromised, ...args);
                }

                else if (typeof dataPromised[callback] == "function") {
                    resultResolved = await dataPromised[callback].call(dataPromised, ...args);
                }

                else return resolve(null);
            } catch (error) {
                console.error(error.message);
            }

            clearTimeout(timeout);

            return resolve(resultResolved);
        }).then(next);
    }
}