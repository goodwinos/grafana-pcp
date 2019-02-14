///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />
import _ from 'lodash';
import map from 'lodash/map';
import isObject from 'lodash/isObject';
import isUndefined from 'lodash/isUndefined';

export class PCPDatasource {

  name: string;
  url: string;
  q: any;
  backendSrv: any;
  templateSrv: any;
  withCredentials: boolean;
  headers: any;

  /** @ngInject **/
  constructor(instanceSettings, private $q, backendSrv, templateSrv) {
    this.name = instanceSettings.name;
    this.url = instanceSettings.url;
    this.q = $q;
    this.backendSrv = backendSrv;
    this.templateSrv = templateSrv;
    this.withCredentials = instanceSettings.withCredentials;
    this.headers = { 'Content-Type': 'application/json' };
    if (typeof instanceSettings.basicAuth === 'string' && instanceSettings.basicAuth.length > 0) {
      this.headers['Authorization'] = instanceSettings.basicAuth;
    }
  }

  queryPost(options) {
    // query using a POST - has query for all panel refIDs in the one POST request
    const query = options;
    query.targets = this.buildQueryTargets(options);

    if (query.targets.length <= 0) {
      return this.q.when({ data: [] });
    }

    if (this.templateSrv.getAdhocFilters) {
      query.adhocFilters = this.templateSrv.getAdhocFilters(this.name);
    } else {
      query.adhocFilters = [];
    }

    // options.scopedVars = { ...this.getVariables(), ...options.scopedVars };

    return this.doRequest({
      url: this.url + '/grafana/query',
      data: query,
      method: 'POST',
    });
  }

  query(options) {
    // query using an array of GETs, one panel refId per URL
    const queries: any = [];
    const query = options;
    query.targets = this.buildQueryTargets(options);

    if (query.targets.length <= 0) {
      return this.q.when({ data: [] });
    }
    console.log("DEBUG query.targets.length="+query.targets.length);
    for (let i=0; i < query.targets.length; i++) {
      console.log("-->> DEBUG query.targets[" + i + "] refId="+query.targets[i].refId+",target="+query.targets[i].target);
      queries.push(query.targets[i]);
    }

    if (this.templateSrv.getAdhocFilters) {
      query.adhocFilters = this.templateSrv.getAdhocFilters(this.name);
    } else {
      query.adhocFilters = [];
    }

    if (query.targets.length === 1) {
      // single refId - this works
      return this.doRequest({
	// note: time window options not currently supported by pmproxy back-end
	url: this.url + '/grafana/query' + '?refId=' + query.targets[0].refId +
	  // '&start=' + query.range.from + '&finish='+query.range.to + '&interval=' + query.interval +
	  '&expr=' + query.targets[0].target,
	method: 'GET',
      });

    } else {

      // multiple refIds (panel queries) - this doesn't work yet
      const allQueryPromise = _.map(queries, query => {
	const url: string = this.url + '/grafana/query' + '?refId=' + query.refId + '&expr=' + query.target;
	console.log('DEBUG QUERY allQueryPromise url=' + url);
	return this.doRequest({
	  url: url,
	  data: [], // TODO what goes here?
	  method: 'GET',
	}).then((response) => {
	  return response.data;
	});
      });
    }
  }

  testDatasource() {
    return this.doRequest({
      url: this.url + '/grafana',
      method: 'GET',
    }).then((response) => {
      if (response.status === 200) {
        return { status: 'success', message: 'PCP Data source is working', title: 'Success' };
      }

      return {
        status: 'error',
        message: 'PCP Data source is not working: ' + response.message, title: 'Error',
      };
    });
  }

  annotationQuery(options) {
    const query = this.templateSrv.replace(options.annotation.query, {}, 'glob');

    const annotationQuery = {
      annotation: {
        query,
        name: options.annotation.name,
        datasource: options.annotation.datasource,
        enable: options.annotation.enable,
        iconColor: options.annotation.iconColor,
      },
      range: options.range,
      rangeRaw: options.rangeRaw,
      variables: this.getVariables(),
    };

    return this.doRequest({
      url: this.url + '/grafana/annotations',
      method: 'POST',
      data: annotationQuery,
    }).then((result) => {
      return result.data;
    });
  }

  metricFindQuery(query) {
    const interpolated = {
      target: this.templateSrv.replace(query, null, 'regex'),
    };

    return this.doRequest({
      url: this.url + '/grafana/search',
      data: interpolated,
      method: 'POST',
    }).then(this.mapToTextValue);
  }

  mapToTextValue(result) {
    return map(result.data, (d, i) => {
      if (d && d.text && d.value) {
        return { text: d.text, value: d.value };
      }

      if (isObject(d)) {
        return { text: d, value: i };
      }
      return { text: d, value: d };
    });
  }

  doRequest(options) {
    options.withCredentials = this.withCredentials;
    options.headers = this.headers;

    return this.backendSrv.datasourceRequest(options);
  }

  buildQueryTargets(options) {
    return options.targets
      .filter((target) => {
        // remove placeholder targets
        return target.target !== 'select metric';
      })
      .map((target) => {
        let data = target.data;

        if (typeof data === 'string' && data.trim() === '') {
          data = null;
        }

        if (data) {
          data = JSON.parse(data);
        }

        return {
          data,
          target: this.templateSrv.replace(target.target, options.scopedVars, 'regex'),
          refId: target.refId,
          hide: target.hide,
          type: target.type,
        };
      });
  }

  getVariables() {
    const index = isUndefined(this.templateSrv.index) ? {} : this.templateSrv.index;
    const variables = {};
    Object.keys(index).forEach((key) => {
      const variable = index[key];
      variables[variable.name] = {
        text: variable.current.text,
        value: variable.current.value,
      };
    });

    return variables;
  }

  getTagKeys(options) {
    return new Promise((resolve, reject) => {
      this.doRequest({
        url: this.url + '/grafana/tag-keys',
        method: 'POST',
        data: options,
      }).then((result) => {
        return resolve(result.data);
      });
    });
  }

  getTagValues(options) {
    return new Promise((resolve, reject) => {
      this.doRequest({
        url: this.url + '/grafana/tag-values',
        method: 'POST',
        data: options,
      }).then((result) => {
        return resolve(result.data);
      });
    });
  }

}