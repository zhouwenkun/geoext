/* Copyright (c) 2015-present The Open Source Geospatial Foundation
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
/**
 * A store that synchronizes a collection of layers (e.g. of an OpenLayers.Map)
 * with a layer store holding GeoExt.data.model.Layer instances.
 *
 * @class GeoExt.data.store.Layers
 */
Ext.define('GeoExt.data.store.Layers', {
    extend: 'Ext.data.Store',
    alternateClassName: ['GeoExt.data.LayerStore'],
    requires: [
        'GeoExt.data.model.Layer'
    ],

    mixins: [
        'GeoExt.mixin.SymbolCheck'
    ],

    // <debug>
    symbols: [
        'ol.Collection#clear',
        'ol.Collection#forEach',
        'ol.Collection#getArray',
        'ol.Collection#insertAt',
        'ol.Collection#on',
        'ol.Collection#push',
        'ol.Collection#remove',
        'ol.layer.Layer',
        'ol.layer.Layer#get',
        'ol.layer.Layer#on',
        'ol.layer.Layer#set',
        'ol.Map',
        'ol.Map#getLayers'
    ],
    // </debug>

    model: 'GeoExt.data.model.Layer',

    config: {
        /**
         * An OL map instance, whose layers will be managed by the store.
         *
         * @cfg {ol.Map} map
         */
        map: null,

        /**
         * A collection of ol.layer.Base objects, which will be managed by
         * the store.
         *
         * @cfg {ol.Collection} layers
         */
        layers: null,

        /**
         * An optional function called to filter records used in changeLayer
         * function
         *
         * @cfg {Function} changeLayerFilterFn
         */
        changeLayerFilterFn: null
    },

    /**
     * Constructs an instance of the layer store.
     *
     * @param {Object} config The configuration object.
     */
    constructor: function(config) {
        var me = this;

        me.callParent([config]);

        if (config.map) {
            this.bindMap(config.map);
        } else if (config.layers) {
            this.bindLayers(config.layers);
        }
    },

    /**
     * Bind this store to a collection of layers; once bound, the store is
     * synchronized with the layer collection and vice-versa.
     *
     * @param  {ol.Collection} layers The layer collection (`ol.layer.Base`).
     * @param  {ol.Map} map Optional map from which the layers were derived
     */
    bindLayers: function(layers, map) {
        var me = this;

        if (!me.layers) {
            me.layers = layers;
        }

        if (me.layers instanceof ol.layer.Group) {
            me.layers = me.layers.getLayers();
        }

        var mapLayers = me.layers;
        mapLayers.forEach(function(layer) {
            me.loadRawData(layer, true);
        });

        mapLayers.forEach(function(layer) {
            me.bindLayer(layer);
        });
        mapLayers.on('add', me.onAddLayer, me);
        mapLayers.on('remove', me.onRemoveLayer, me);

        me.on({
            'load': me.onLoad,
            'clear': me.onClear,
            'add': me.onAdd,
            'remove': me.onRemove,
            'update': me.onStoreUpdate,
            'scope': me
        });

        me.data.on({
            'replace': me.onReplace,
            'scope': me
        });
        me.fireEvent('bind', me, map);
    },

    /**
     * Bind this store to a map instance; once bound, the store is synchronized
     * with the map and vice-versa.
     *
     * @param {ol.Map} map The map instance.
     */
    bindMap: function(map) {
        var me = this;

        if (!me.map) {
            me.map = map;
        }

        if (map instanceof ol.Map) {
            var mapLayers = map.getLayers();
            me.bindLayers(mapLayers, map);
        }
    },

    /**
     * Bind the layer to the record and initialize synchronized values.
     *
     * @param {ol.layer.Base} layer The layer.
     * @param {Ext.data.Model} [record] The record, if not set it will be
     *      searched for.
     */
    bindLayer: function(layer, record) {
        var me = this;
        layer.on('propertychange', me.onChangeLayer, me);
        if (record === undefined) {
            record = this.getRecordForLayer(layer);
        }
        Ext.Array.forEach(record.synchronizedProperties,
            function(prop) {
                me.synchronize(record, layer, prop);
            });
    },

    /**
     * Gets the associated record for the layer. Uses `changeLayerFilterFn` if
     * set.
     * @param {ol.layer.Base} layer The layer.
     * @return {Ext.data.Model|undefined} The record or undefined if it doesn't
     *      exist.
     */
    getRecordForLayer: function(layer) {
        var me = this;
        var recordIndex;
        if (Ext.isFunction(me.changeLayerFilterFn)) {
            recordIndex = this.findBy(me.changeLayerFilterFn);
        } else {
            recordIndex = this.findBy(function(rec) {
                return rec.getOlLayer() === layer;
            });
        }
        if (recordIndex > -1) {
            return this.getAt(recordIndex);
        }
    },

    /**
     * Unbind this store from the layer collection it is currently bound.
     */
    unbindLayers: function() {
        var me = this;

        if (me.layers) {
            me.layers.un('add', me.onAddLayer, me);
            me.layers.un('remove', me.onRemoveLayer, me);
        }
        me.un('load', me.onLoad, me);
        me.un('clear', me.onClear, me);
        me.un('add', me.onAdd, me);
        me.un('remove', me.onRemove, me);
        me.un('update', me.onStoreUpdate, me);

        me.data.un('replace', me.onReplace, me);
    },

    /**
     * Unbind this store from the map it is currently bound.
     */
    unbindMap: function() {
        var me = this;

        me.unbindLayers();

        me.map = null;
    },

    /**
     * Handler for layer changes. When layer order changes, this moves the
     * appropriate record within the store.
     *
     * @param {ol.ObjectEvent} evt The emitted `ol.Object` event.
     * @private
     */
    onChangeLayer: function(evt) {
        var layer = evt.target;
        var record = this.getRecordForLayer(layer);

        if (record !== undefined) {
            if (evt.key === 'description') {
                record.set('qtip', layer.get('description'));
                if (record.synchronizedProperties.indexOf('description') > -1) {
                    this.synchronize(record, layer, 'description');
                }
            } else if (record.synchronizedProperties.indexOf(evt.key) > -1) {
                this.synchronize(record, layer, evt.key);
            } else {
                this.fireEvent('update', this, record, Ext.data.Record.EDIT,
                    null, {});
            }
        }
    },

    /**
     * Handler for a layer collection's `add` event.
     *
     * @param {ol.CollectionEvent} evt The emitted `ol.Collection` event.
     * @private
     */
    onAddLayer: function(evt) {
        var layer = evt.element;
        var index = this.layers.getArray().indexOf(layer);
        var me = this;
        if (!me._adding) {
            me._adding = true;
            var result = me.proxy.reader.read(layer);
            me.insert(index, result.records);
            delete me._adding;
        }
        me.bindLayer(layer);
    },

    /**
     * Handler for layer collection's `remove` event.
     *
     * @param {ol.CollectionEvent} evt The emitted `ol.Collection` event.
     * @private
     */
    onRemoveLayer: function(evt) {
        var me = this;
        if (!me._removing) {
            var layer = evt.element;
            var rec = me.getByLayer(layer);
            if (rec) {
                me._removing = true;
                layer.un('propertychange', me.onChangeLayer, me);
                me.remove(rec);
                delete me._removing;
            }
        }
    },

    /**
     * Handler for a store's `load` event.
     *
     * @param {Ext.data.Store} store The store that loaded.
     * @param {Ext.data.Model[]} records An array of loades model instances.
     * @param {Boolean} successful Whether loading was successful or not.
     * @private
     */
    onLoad: function(store, records, successful) {
        var me = this;
        if (successful) {
            if (!Ext.isArray(records)) {
                records = [records];
            }
            if (!me._addRecords) {
                me._removing = true;
                me.layers.forEach(function(layer) {
                    layer.un('propertychange', me.onChangeLayer, me);
                });
                me.layers.getLayers().clear();
                delete me._removing;
            }
            var len = records.length;
            if (len > 0) {
                var layers = new Array(len);
                for (var i = 0; i < len; i++) {
                    var record = records[i];
                    layers[i] = record.getOlLayer();
                    me.bindLayer(layers[i], record);
                }
                me._adding = true;
                me.layers.extend(layers);
                delete me._adding;
            }
        }
        delete me._addRecords;
    },

    /**
     * Handler for a store's `clear` event.
     *
     * @private
     */
    onClear: function() {
        var me = this;
        me._removing = true;
        me.layers.forEach(function(layer) {
            layer.un('propertychange', me.onChangeLayer, me);
        });
        me.layers.clear();
        delete me._removing;
    },

    /**
     * Handler for a store's `add` event.
     *
     * @param {Ext.data.Store} store The store to which a model instance was
     *     added.
     * @param {Ext.data.Model[]} records The array of model instances that were
     *     added.
     * @param {Number} index The index at which the model instances were added.
     * @private
     */
    onAdd: function(store, records, index) {
        var me = this;
        if (!me._adding) {
            me._adding = true;
            var layer;
            for (var i = 0, ii = records.length; i < ii; ++i) {
                layer = records[i].getOlLayer();
                me.bindLayer(layer, records[i]);
                if (index === 0) {
                    me.layers.push(layer);
                } else {
                    me.layers.insertAt(index, layer);
                }
            }
            delete me._adding;
        }
    },

    /**
     * Handler for a store's `remove` event.
     *
     * @param {Ext.data.Store} store The store from which a model instances
     *     were removed.
     * @param {Ext.data.Model[]} records The array of model instances that were
     *     removed.
     * @private
     */
    onRemove: function(store, records) {
        var me = this;
        var record;
        var layer;
        var found;
        var i;
        var ii;

        if (!me._removing) {
            var compareFunc = function(el) {
                if (el === layer) {
                    found = true;
                }
            };
            for (i = 0, ii = records.length; i < ii; ++i) {
                record = records[i];
                layer = record.getOlLayer();
                found = false;
                layer.un('propertychange', me.onChangeLayer, me);
                me.layers.forEach(compareFunc);
                if (found) {
                    me._removing = true;
                    me.removeMapLayer(record);
                    delete me._removing;
                }
            }
        }
    },

    /**
     * Handler for a store's `update` event.
     *
     * @param {Ext.data.Store} store The store which was updated.
     * @param {Ext.data.Model} record The updated model instance.
     * @param {String} operation The operation, either Ext.data.Model.EDIT,
     *     Ext.data.Model.REJECT or Ext.data.Model.COMMIT.
     * @param {string[]|null} modifiedFieldNames The fieldnames that were
     *     modified in this operation.
     * @private
     */
    onStoreUpdate: function(store, record, operation, modifiedFieldNames) {
        var me = this;
        if (operation === Ext.data.Record.EDIT) {
            if (modifiedFieldNames) {
                var layer = record.getOlLayer();
                Ext.Array.forEach(modifiedFieldNames, function(prop) {
                    if (record.synchronizedProperties.indexOf(prop) > -1) {
                        me.synchronize(layer, record, prop);
                    }
                });
            }
        }
    },

    /**
     * Removes a record's layer from the bound map.
     *
     * @param {Ext.data.Model} record The removed model instance.
     * @private
     */
    removeMapLayer: function(record) {
        this.layers.remove(record.getOlLayer());
    },

    /**
     * Handler for a store's data collections' `replace` event.
     *
     * @param {String} key The associated key.
     * @param {Ext.data.Model} oldRecord In this case, a record that has
     *     been replaced.
     * @private
     */
    onReplace: function(key, oldRecord) {
        this.removeMapLayer(oldRecord);
    },

    /**
     * Get the record for the specified layer.
     *
     * @param {ol.layer.Base} layer The layer to get a model instance for.
     * @return {Ext.data.Model} The corresponding model instance or undefined if
     *     not found.
     */
    getByLayer: function(layer) {
        var index = this.findBy(function(r) {
            return r.getOlLayer() === layer;
        });
        if (index > -1) {
            return this.getAt(index);
        }
    },

    /**
     * Unbinds listeners by calling #unbindMap (thus #unbindLayers) prior to
     * being destroyed.
     *
     * @private
     */
    destroy: function() {
        // unbindMap calls unbindLayers
        this.unbindMap();
        this.callParent();
    },

    /**
     * Overload loadRecords to set a flag if `addRecords` is `true` in the load
     * options. ExtJS does not pass the load options to "load" callbacks, so
     * this is how we provide that information to `onLoad`.
     *
     * @param {Ext.data.Model[]} records The array of records to load.
     * @param {Object} options The loading options.
     * @param {Boolean} [options.addRecords=false] Pass `true` to add these
     *     records to the existing records, `false` to remove the Store's
     *     existing records first.
     * @private
     */
    loadRecords: function(records, options) {
        if (options && options.addRecords) {
            this._addRecords = true;
        }
        this.callParent(arguments);
    },

    /**
     * @inheritdoc
     *
     * The event firing behaviour of Ext.4.1 is reestablished here. See also:
     * [This discussion on the Sencha forum](http://www.sencha.com/forum/
     * showthread.php?253596-beforeload-is-not-fired-by-loadRawData).
     */
    loadRawData: function(data, append) {
        var me = this;
        var result = me.proxy.reader.read(data);
        var records = result.records;

        if (result.success) {
            me.totalCount = result.total;
            me.loadRecords(records, append ? me.addRecordsOptions : undefined);
            me.fireEvent('load', me, records, true);
        }
    },

    /**
     * This function synchronizes a value, but only sets it if it is different.
     * @param {Ext.data.Model|ol.layer.Base} destination The destination.
     * @param {Ext.data.Model|ol.layer.Base} source The source.
     * @param {string} prop The property that should get synchronized.
     */
    synchronize: function(destination, source, prop) {
        var value = source.get(prop);
        if (value !== destination.get(prop)) {
            destination.set(prop, value);
        }
    }
});
