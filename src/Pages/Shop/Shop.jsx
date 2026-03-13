import './Shop.css';

function Shop() {
   return <div className="shop">
      {ShopRow({title: "events", items: {}})}
      {ShopRow({title: "normal", items: {}})}
      {ShopRow({title: "break", items: {}})}
      {ShopRow({title: "test", items: {}})}
      {ShopRow({title: "test", items: {}})}
      {ShopRow({title: "test", items: {}})}
   </div>
}

function ShopRow({title, items}) {
   return <div className="shop-row">
      <span>{title}</span>
      <hr />
      <div className="shop-item-scroll">
      </div>
   </div>
}

function ShopItem({item}) {

}

function ItemInfoPopup() {

}

export default Shop;