class UpdateManager {
    
    async processPartialUpdate(data) {
        // This processes partial update signal meta response performed on page load.
        // Its output is the same as SW's message received by `receivedFromSW`.
        const {tables, query, hashsum} = data
        const out = []
        for (let tableName of tables.split(',')) {
            // let's first establish if this client owns the resource(s) it wants to update
            const table = this.db.tables.find(i => i.name === tableName)
            const syncTable = this.db.sync || this.db.tables.find(i => i.name === 'sync')
            if (!table || !syncTable) return
            const coll = await table.where(query)
            const collCount = await coll.count()
            if (!collCount) {
                console.info(`Resource '${tableName}' won't be updated, as relevant records not locally present.`)
                continue
            }
            data.table = table
            data.tableName = tableName
            const context = await this.prepareCommitContext(data)
            if (!context) continue
            // update hashsum in IDB for this resource
            await syncTable.put({
                hashsum,
                table_name: tableName,
                timestamp: new Date().getTime()
            })
            // now, if this is the main thread, let's dispatch a method defined on another class
            // that will modify the data in vuex.
            if (this.commitPartialUpdate) {
                await this.commitPartialUpdate(context)
                continue
            }
            out.push(context)
        }
        return out
    }

    async prepareCommitContext (data) {
        const {table, tableName, orig_op, query, deviceID, op} = data

        if (orig_op === 'delete') {
            // no need to fetch anything, just delete the relevant entry from IDB
            const res = await table.where(query).delete()
            if (res) {
                return {
                    query,
                    deviceID,
                    resource: tableName,
                    op: 'delete'
                }
            }
            return {}
        }
        const headers = {
            'Content-Type': 'application/json',
            Range: op
        }
        const resp = await fetch(data.path, {
            headers,
            body: JSON.stringify(query),
            method: 'POST'
        })
        if (resp.ok) {
            const serverData = await resp.json()
            let res
            if (orig_op === 'patch') {
                res = await table.where(query).modify(serverData)
            }
            else if (orig_op === 'post') {
                res = await table.add(serverData)
            }
            else if (orig_op === 'put') {
                res = await table.where(query).modify(function() {
                    this.value = serverData
                })
            }
            if (res) {
                return {
                    query,
                    deviceID,
                    op: orig_op,
                    resource: tableName,
                    payload: serverData
                }
            }
        }
    }

}
export default UpdateManager
// self.UpdateManager = UpdateManager