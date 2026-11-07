function calculateBatch(input) {
  var jobs = input.jobs;
  var results = [];
  var failures = 0;

  function readJob(index, callback) {
    if (index >= jobs.length) {
      callback(new Error('no such job'));
      return;
    }
    callback(null, jobs[index]);
  }

  function runJob(job, error, done) {
    if (error) {
      failures = failures + 1;
      done(null);
      return;
    }
    var operators = ['+', '-', '*', '/', '%'];
    if (operators.indexOf(job.op) === -1) {
      failures = failures + 1;
      done(null);
      return;
    }
    var operation = new Function('a', 'b', 'return a ' + job.op + ' b;');
    done(operation(job.a, job.b));
  }

  readJob(0, function (error1, job1) {
    runJob(job1, error1, function (value1) {
      results.push(value1);
      readJob(1, function (error2, job2) {
        runJob(job2, error2, function (value2) {
          results.push(value2);
          readJob(2, function (error3, job3) {
            runJob(job3, error3, function (value3) {
              results.push(value3);
            });
          });
        });
      });
    });
  });

  return { results: results, failures: failures };
}
